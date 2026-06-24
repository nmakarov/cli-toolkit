/**
 * AWS discovery component
 *
 * A thin, read-only wrapper over a few AWS SDK v3 clients (STS, EC2, Route53)
 * with cli-toolkit conventions:
 *
 *   const aws = await Aws.init(context);
 *   const me  = await aws.whoAmI();
 *   const zones = await aws.listHostedZones();
 *
 * The whole point: given just an access key + secret (usually from .env), it can
 * *discover* the boring-to-look-up bits of an AWS account (account id, regions,
 * VPCs, subnets, security groups, key pairs, Route53 hosted zones, the latest
 * Ubuntu AMI) so scripts can pre-fill config (e.g. a terraform.tfvars) instead of
 * making you hunt through the console.
 *
 * Credentials + region are resolved via context.params, so they come from CLI,
 * env, or .env transparently:
 *   awsAccessKeyId      -> AWS_ACCESS_KEY_ID
 *   awsSecretAccessKey  -> AWS_SECRET_ACCESS_KEY
 *   awsSessionToken     -> AWS_SESSION_TOKEN      (optional, for temp creds)
 *   awsRegion           -> AWS_REGION             (default us-east-1)
 *
 * If no explicit keys are found, the SDK's default credential chain is used
 * (shared config/profile, instance role, etc.) — so AWS_PROFILE also works.
 *
 * Everything here is read-only (Describe / List / Get calls). It never mutates AWS.
 */

import {
    STSClient,
    GetCallerIdentityCommand,
} from "@aws-sdk/client-sts";
import {
    EC2Client,
    DescribeRegionsCommand,
    DescribeAvailabilityZonesCommand,
    DescribeVpcsCommand,
    DescribeSubnetsCommand,
    DescribeSecurityGroupsCommand,
    DescribeKeyPairsCommand,
    DescribeImagesCommand,
} from "@aws-sdk/client-ec2";
import {
    Route53Client,
    ListHostedZonesCommand,
} from "@aws-sdk/client-route-53";

const DEFAULT_REGION = "us-east-1";
const CANONICAL_OWNER_ID = "099720109477"; // Ubuntu images
const DEFAULT_UBUNTU_PATTERN = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*";

function nameTag(tags) {
    const t = (tags ?? []).find(x => x.Key === "Name");
    return t?.Value ?? null;
}

export class Aws {
    /**
     * Resolve credentials/region from params and return an Aws instance.
     * Does not call AWS until you invoke a method (clients are lazy).
     */
    static async init(context, options = {}) {
        // Tolerate blank/missing values (e.g. an env var present but empty, like
        // a half-filled .env): treat them as "not set" rather than failing param
        // validation, so we fall back cleanly to the SDK default credential chain.
        const getOpt = async (k) => {
            try {
                const v = await context?.params?.get?.(k, "string");
                return v != null && String(v).trim() !== "" ? v : undefined;
            } catch {
                return undefined;
            }
        };

        const config = {
            region: options.region ?? (await getOpt("awsRegion")) ?? DEFAULT_REGION,
            accessKeyId: options.accessKeyId ?? (await getOpt("awsAccessKeyId")),
            secretAccessKey: options.secretAccessKey ?? (await getOpt("awsSecretAccessKey")),
            sessionToken: options.sessionToken ?? (await getOpt("awsSessionToken")),
        };

        const aws = new Aws(context, config);
        context?.logger?.debug?.(
            `[aws] region=${config.region} credentials=${config.accessKeyId ? "explicit" : "default-chain"}`,
        );
        return aws;
    }

    constructor(context, config) {
        this.logger = context?.logger ?? console;
        this.region = config.region || DEFAULT_REGION;

        // Build an explicit credentials object only when keys were supplied;
        // otherwise leave undefined so the SDK uses its default chain (profile,
        // instance role, env, …).
        this._credentials = config.accessKeyId && config.secretAccessKey
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
                ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
            }
            : undefined;

        /** True when explicit access key + secret were supplied (env/.env/CLI). */
        this.hasExplicitCredentials = !!this._credentials;

        // Quiet the AWS SDK v3 "node >=22 required after Jan 2027" notice.
        process.env.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED ??= "true";

        this._clients = {};
    }

    // ── clients (lazy, optionally region-scoped) ──────────────────────────────
    _clientConfig(region) {
        const cfg = { region: region || this.region };
        if (this._credentials) cfg.credentials = this._credentials;
        return cfg;
    }

    _sts() {
        return (this._clients.sts ??= new STSClient(this._clientConfig()));
    }

    _ec2(region) {
        const key = `ec2:${region || this.region}`;
        return (this._clients[key] ??= new EC2Client(this._clientConfig(region)));
    }

    _route53() {
        // Route53 is global; region is irrelevant but the client still wants one.
        return (this._clients.route53 ??= new Route53Client(this._clientConfig()));
    }

    getRegion() { return this.region; }

    // ── credentials ─────────────────────────────────────────────────────────────
    /**
     * Are any credentials available *before* hitting AWS? Returns
     * { ok, source } — explicit keys, or a resolvable default chain (profile/SSO/
     * instance role). { ok:false } means there's nothing to even try with.
     * Note: "ok" only means creds were *found*, not that AWS will accept them.
     */
    async checkCredentials() {
        if (this.hasExplicitCredentials) {
            return { ok: true, source: "explicit keys (env/.env/CLI)" };
        }
        try {
            const provider = this._sts().config.credentials;
            const resolved = typeof provider === "function" ? await provider() : provider;
            if (resolved?.accessKeyId) {
                return { ok: true, source: "default credential chain (profile/SSO/role)" };
            }
        } catch {
            // nothing resolvable
        }
        return { ok: false };
    }

    /** True for "bad/missing credentials" style errors (vs. real failures). */
    static isAuthError(err) {
        const name = err?.name || err?.Code || err?.__type || "";
        return [
            "CredentialsProviderError",
            "InvalidClientTokenId",
            "UnrecognizedClientException",
            "AuthFailure",
            "AccessDenied",
            "AccessDeniedException",
            "ExpiredToken",
            "ExpiredTokenException",
            "SignatureDoesNotMatch",
            "MissingAuthenticationToken",
        ].includes(name);
    }

    /** Short, precise instructions for getting AWS credentials into .env. */
    static credentialsHelp(region = DEFAULT_REGION) {
        return [
            "No usable AWS credentials were found (or AWS rejected them).",
            "",
            "Put a read-only access key in the project's .env:",
            "",
            "  AWS_ACCESS_KEY_ID=AKIA...",
            "  AWS_SECRET_ACCESS_KEY=...",
            `  AWS_REGION=${region}        # optional (default ${DEFAULT_REGION})`,
            "",
            "Get a key from the AWS console (~2 min):",
            "  1. IAM → Users → create or pick a user (console sign-in not needed).",
            '  2. Attach a policy — "ReadOnlyAccess" (AWS managed) is enough for discovery.',
            '  3. The user → "Security credentials" → "Create access key" → "CLI".',
            "  4. Copy the Access key ID + Secret access key (the secret shows only once).",
            "  5. Paste both into .env, then re-run.",
            "     Direct link: https://console.aws.amazon.com/iam/home#/users",
            "",
            "Prefer a named profile or an EC2 instance role? Re-run with AWS_PROFILE=<name>",
            "set (or on the instance) and credentials resolve automatically.",
        ].join("\n");
    }

    // ── identity ──────────────────────────────────────────────────────────────
    /** { account, arn, userId } — confirm which account/identity the keys belong to. */
    async whoAmI() {
        const out = await this._sts().send(new GetCallerIdentityCommand({}));
        return { account: out.Account, arn: out.Arn, userId: out.UserId };
    }

    // ── regions / AZs ──────────────────────────────────────────────────────────
    /** Enabled region names, sorted. */
    async listRegions({ allRegions = false } = {}) {
        const out = await this._ec2().send(new DescribeRegionsCommand({ AllRegions: allRegions }));
        return (out.Regions ?? []).map(r => r.RegionName).sort();
    }

    /** Availability zone names for a region (defaults to the instance region). */
    async listAvailabilityZones(region) {
        const out = await this._ec2(region).send(new DescribeAvailabilityZonesCommand({}));
        return (out.AvailabilityZones ?? [])
            .filter(z => z.State === "available")
            .map(z => z.ZoneName)
            .sort();
    }

    // ── VPC / subnets / SGs / key pairs ────────────────────────────────────────
    /** [{ id, cidr, isDefault, name }] in a region. */
    async listVpcs(region) {
        const out = await this._ec2(region).send(new DescribeVpcsCommand({}));
        return (out.Vpcs ?? []).map(v => ({
            id: v.VpcId,
            cidr: v.CidrBlock,
            isDefault: !!v.IsDefault,
            name: nameTag(v.Tags),
        }));
    }

    /** [{ id, vpcId, az, cidr, public, name }]; pass vpcId to scope. */
    async listSubnets({ vpcId, region } = {}) {
        const Filters = vpcId ? [{ Name: "vpc-id", Values: [vpcId] }] : undefined;
        const out = await this._ec2(region).send(new DescribeSubnetsCommand({ Filters }));
        return (out.Subnets ?? []).map(s => ({
            id: s.SubnetId,
            vpcId: s.VpcId,
            az: s.AvailabilityZone,
            cidr: s.CidrBlock,
            public: !!s.MapPublicIpOnLaunch,
            name: nameTag(s.Tags),
        }));
    }

    /** [{ id, name, vpcId, description }]; pass vpcId to scope. */
    async listSecurityGroups({ vpcId, region } = {}) {
        const Filters = vpcId ? [{ Name: "vpc-id", Values: [vpcId] }] : undefined;
        const out = await this._ec2(region).send(new DescribeSecurityGroupsCommand({ Filters }));
        return (out.SecurityGroups ?? []).map(g => ({
            id: g.GroupId,
            name: g.GroupName,
            vpcId: g.VpcId,
            description: g.Description,
        }));
    }

    /** [{ name, fingerprint }] EC2 key pairs in a region. */
    async listKeyPairs(region) {
        const out = await this._ec2(region).send(new DescribeKeyPairsCommand({}));
        return (out.KeyPairs ?? []).map(k => ({ name: k.KeyName, fingerprint: k.KeyFingerprint }));
    }

    // ── Route53 ────────────────────────────────────────────────────────────────
    /** [{ id, name, private, recordCount }] — id is the bare zone id (no /hostedzone/). */
    async listHostedZones() {
        const zones = [];
        let marker;
        do {
            const out = await this._route53().send(new ListHostedZonesCommand({ Marker: marker }));
            for (const z of out.HostedZones ?? []) {
                zones.push({
                    id: (z.Id ?? "").replace("/hostedzone/", ""),
                    name: (z.Name ?? "").replace(/\.$/, ""), // strip trailing dot
                    private: !!z.Config?.PrivateZone,
                    recordCount: z.ResourceRecordSetCount,
                });
            }
            marker = out.IsTruncated ? out.NextMarker : undefined;
        } while (marker);
        return zones;
    }

    /**
     * Best hosted zone for a domain: exact match, else the longest zone name that
     * is a suffix of the domain (so "api.foo.com" matches the "foo.com" zone).
     * Returns the zone object or null.
     */
    async findHostedZoneForDomain(domain) {
        const target = String(domain ?? "").replace(/\.$/, "").toLowerCase();
        if (!target) return null;
        const zones = await this.listHostedZones();
        const exact = zones.find(z => z.name.toLowerCase() === target);
        if (exact) return exact;
        return zones
            .filter(z => target.endsWith(`.${z.name.toLowerCase()}`))
            .sort((a, b) => b.name.length - a.name.length)[0] ?? null;
    }

    // ── AMI lookup ──────────────────────────────────────────────────────────────
    /**
     * Latest Ubuntu AMI matching a name pattern in a region.
     * Returns { id, name, creationDate, architecture } or null.
     */
    async findLatestUbuntuAmi({ region, pattern = DEFAULT_UBUNTU_PATTERN, architecture = "x86_64" } = {}) {
        const out = await this._ec2(region).send(new DescribeImagesCommand({
            Owners: [CANONICAL_OWNER_ID],
            Filters: [
                { Name: "name", Values: [pattern] },
                { Name: "virtualization-type", Values: ["hvm"] },
                { Name: "state", Values: ["available"] },
                ...(architecture ? [{ Name: "architecture", Values: [architecture] }] : []),
            ],
        }));
        const newest = (out.Images ?? [])
            .sort((a, b) => String(b.CreationDate).localeCompare(String(a.CreationDate)))[0];
        if (!newest) return null;
        return {
            id: newest.ImageId,
            name: newest.Name,
            creationDate: newest.CreationDate,
            architecture: newest.Architecture,
        };
    }
}
