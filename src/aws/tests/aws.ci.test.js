import { describe, expect, it, vi } from "vitest";
import { Aws } from "../index.js";

function makeAws(overrides = {}) {
    return new Aws(
        { logger: { debug: vi.fn() } },
        {
            region: "us-west-2",
            accessKeyId: "AKIATEST",
            secretAccessKey: "secret",
            ...overrides,
        },
    );
}

describe("Aws", () => {
    it("init resolves explicit keys and falls back on blank/missing params", async () => {
        const params = {
            get: vi.fn(async (k) => {
                if (k === "awsRegion") return "eu-west-1";
                if (k === "awsAccessKeyId") return "  ";
                throw new Error("missing");
            }),
        };
        const aws = await Aws.init({ params, logger: { debug: vi.fn() } });
        expect(aws.getRegion()).toBe("eu-west-1");
        expect(aws.hasExplicitCredentials).toBe(false);

        const withOpts = await Aws.init(
            { params: { get: async () => undefined } },
            { region: "ca-central-1", accessKeyId: "A", secretAccessKey: "B", sessionToken: "T" },
        );
        expect(withOpts.hasExplicitCredentials).toBe(true);
        expect(withOpts.getRegion()).toBe("ca-central-1");
        expect(withOpts._clientConfig("eu-central-1").region).toBe("eu-central-1");
        expect(withOpts._clientConfig().credentials.sessionToken).toBe("T");
    });

    it("isAuthError and credentialsHelp", () => {
        expect(Aws.isAuthError({ name: "ExpiredToken" })).toBe(true);
        expect(Aws.isAuthError({ name: "Throttling" })).toBe(false);
        expect(Aws.credentialsHelp("eu-west-1")).toContain("AWS_REGION=eu-west-1");
    });

    it("checkCredentials reports explicit keys or a resolvable chain", async () => {
        const explicit = makeAws();
        expect(await explicit.checkCredentials()).toEqual({
            ok: true,
            source: "explicit keys (env/.env/CLI)",
        });

        const chain = new Aws({ logger: {} }, { region: "us-east-1" });
        chain._clients.sts = {
            config: { credentials: async () => ({ accessKeyId: "AKIA" }) },
        };
        expect(await chain.checkCredentials()).toMatchObject({ ok: true });

        const empty = new Aws({ logger: {} }, { region: "us-east-1" });
        empty._clients.sts = {
            config: { credentials: async () => ({}) },
        };
        expect(await empty.checkCredentials()).toEqual({ ok: false });

        const boom = new Aws({ logger: {} }, { region: "us-east-1" });
        boom._clients.sts = {
            config: {
                credentials: async () => {
                    throw new Error("nope");
                },
            },
        };
        expect(await boom.checkCredentials()).toEqual({ ok: false });
    });

    it("maps identity, regions, AZs, VPCs, subnets, SGs, key pairs", async () => {
        const aws = makeAws();
        aws._clients.sts = {
            send: vi.fn(async () => ({ Account: "111", Arn: "arn:aws:iam::111:user/x", UserId: "AID" })),
        };
        aws._clients["ec2:us-west-2"] = {
            send: vi.fn(async (cmd) => {
                const name = cmd.constructor.name;
                if (name === "DescribeRegionsCommand") {
                    return { Regions: [{ RegionName: "us-west-2" }, { RegionName: "us-east-1" }] };
                }
                if (name === "DescribeAvailabilityZonesCommand") {
                    return {
                        AvailabilityZones: [
                            { State: "available", ZoneName: "us-west-2b" },
                            { State: "unavailable", ZoneName: "us-west-2-wl1" },
                            { State: "available", ZoneName: "us-west-2a" },
                        ],
                    };
                }
                if (name === "DescribeVpcsCommand") {
                    return {
                        Vpcs: [
                            { VpcId: "vpc-1", CidrBlock: "10.0.0.0/16", IsDefault: true, Tags: [{ Key: "Name", Value: "main" }] },
                        ],
                    };
                }
                if (name === "DescribeSubnetsCommand") {
                    return {
                        Subnets: [
                            {
                                SubnetId: "subnet-1",
                                VpcId: "vpc-1",
                                AvailabilityZone: "us-west-2a",
                                CidrBlock: "10.0.1.0/24",
                                MapPublicIpOnLaunch: true,
                                Tags: [],
                            },
                        ],
                    };
                }
                if (name === "DescribeSecurityGroupsCommand") {
                    return {
                        SecurityGroups: [
                            { GroupId: "sg-1", GroupName: "web", VpcId: "vpc-1", Description: "web" },
                        ],
                    };
                }
                if (name === "DescribeKeyPairsCommand") {
                    return { KeyPairs: [{ KeyName: "laptop", KeyFingerprint: "aa:bb" }] };
                }
                return {};
            }),
        };

        expect(await aws.whoAmI()).toEqual({
            account: "111",
            arn: "arn:aws:iam::111:user/x",
            userId: "AID",
        });
        expect(await aws.listRegions()).toEqual(["us-east-1", "us-west-2"]);
        expect(await aws.listAvailabilityZones()).toEqual(["us-west-2a", "us-west-2b"]);
        expect(await aws.listVpcs()).toEqual([
            { id: "vpc-1", cidr: "10.0.0.0/16", isDefault: true, name: "main" },
        ]);
        expect(await aws.listSubnets({ vpcId: "vpc-1" })).toEqual([
            {
                id: "subnet-1",
                vpcId: "vpc-1",
                az: "us-west-2a",
                cidr: "10.0.1.0/24",
                public: true,
                name: null,
            },
        ]);
        expect(await aws.listSecurityGroups({ vpcId: "vpc-1" })).toEqual([
            { id: "sg-1", name: "web", vpcId: "vpc-1", description: "web" },
        ]);
        expect(await aws.listKeyPairs()).toEqual([{ name: "laptop", fingerprint: "aa:bb" }]);
    });

    it("lists hosted zones, finds the best suffix match, and picks the newest AMI", async () => {
        const aws = makeAws();
        const page1 = {
            HostedZones: [
                { Id: "/hostedzone/Z1", Name: "example.com.", Config: { PrivateZone: false }, ResourceRecordSetCount: 4 },
            ],
            IsTruncated: true,
            NextMarker: "m2",
        };
        const page2 = {
            HostedZones: [
                { Id: "/hostedzone/Z2", Name: "api.example.com.", Config: { PrivateZone: true }, ResourceRecordSetCount: 2 },
            ],
            IsTruncated: false,
        };
        aws._clients.route53 = {
            send: vi.fn(async (cmd) => {
                const marker = cmd.input?.Marker ?? cmd.Marker;
                return marker ? page2 : page1;
            }),
        };
        const zones = await aws.listHostedZones();
        expect(zones).toEqual([
            { id: "Z1", name: "example.com", private: false, recordCount: 4 },
            { id: "Z2", name: "api.example.com", private: true, recordCount: 2 },
        ]);
        expect(await aws.findHostedZoneForDomain("")).toBe(null);
        expect((await aws.findHostedZoneForDomain("api.example.com")).id).toBe("Z2");
        expect((await aws.findHostedZoneForDomain("www.example.com")).id).toBe("Z1");

        aws._clients["ec2:us-west-2"] = {
            send: vi.fn(async () => ({
                Images: [
                    { ImageId: "ami-old", Name: "old", CreationDate: "2020-01-01T00:00:00.000Z", Architecture: "x86_64" },
                    { ImageId: "ami-new", Name: "new", CreationDate: "2024-01-01T00:00:00.000Z", Architecture: "x86_64" },
                ],
            })),
        };
        expect(await aws.findLatestUbuntuAmi()).toMatchObject({ id: "ami-new", name: "new" });
        aws._clients["ec2:us-west-2"].send = vi.fn(async () => ({ Images: [] }));
        expect(await aws.findLatestUbuntuAmi({ architecture: null })).toBe(null);
    });
});
