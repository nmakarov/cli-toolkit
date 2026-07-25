/**
 * S3 component
 *
 * Thin async wrapper over @aws-sdk/client-s3 v3 with the cli-toolkit conventions:
 *   const s3 = await S3.init(context);
 *
 * Supports multiple "profiles" (local, production, stage, …) selected at runtime
 * via `--bucket=<profile>` (or `BUCKET` / env-suffixed `BUCKET_LOCAL`,
 * `BUCKET_PRODUCTION`). Each profile has its own set of parameters resolved by
 * the framework, mirroring how `Db.init` uses `dbName` → `dbConnectionString${Name}`.
 *
 * Profile selector (often driven by `--env` / `ENV` via Args env-suffixes):
 *   --bucket=local         (default when env=local)
 *   --bucket=production    (default when ENV=production and BUCKET_PRODUCTION=production)
 *   --bucket=stage
 *
 * Per-profile parameters (CLI / env / .env — see @nmakarov/cli-toolkit/params):
 *   s3Bucket{Profile}            string   required  (S3_BUCKET_LOCAL, S3_BUCKET_PRODUCTION, …)
 *   s3Region{Profile}            string   default us-east-1
 *   s3Endpoint{Profile}          string   optional (MinIO/local; unset = real AWS)
 *   s3ForcePathStyle{Profile}    boolean  default false (true for MinIO)
 *   s3AccessKeyId{Profile}       string   optional (omit on EC2 for instance profile)
 *   s3SecretAccessKey{Profile}   string   optional
 *
 * Example (.env — all profiles in one file):
 *   BUCKET_LOCAL=local
 *   BUCKET_PRODUCTION=production
 *   S3_BUCKET_LOCAL=photos-local
 *   S3_REGION_LOCAL=us-east-1
 *   S3_ENDPOINT_LOCAL=http://localhost:9000
 *   S3_FORCE_PATH_STYLE_LOCAL=true
 *   S3_ACCESS_KEY_ID_LOCAL=dev
 *   S3_SECRET_ACCESS_KEY_LOCAL=devdevdev
 *   S3_BUCKET_PRODUCTION=photos-everystate-prod
 *   S3_REGION_PRODUCTION=ca-central-1
 *   …
 */

import {
    S3Client,
    HeadBucketCommand,
    HeadObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    CopyObjectCommand,
    ListObjectsV2Command,
    PutObjectTaggingCommand,
    GetObjectTaggingCommand,
} from "@aws-sdk/client-s3";

import { ParamError } from "../errors.js";

const DEFAULT_PROFILE = "local";

function capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export class S3 {
    /**
     * Build an S3 instance. Reads bucket profile from --bucket (default "local"),
     * then resolves per-profile params, builds the SDK client, and returns the
     * instance. Optionally pings the bucket once to verify reachability.
     */
    static async init(context, options = {}) {
        const profileDef = { bucket: "string" };
        const discovered = context?.params?.getAllForModule?.("s3", profileDef) ?? {};
        const profile = options.bucket ?? discovered.bucket ?? DEFAULT_PROFILE;
        const cap = capitalize(profile);

        const config = {
            profile,
            bucketName: options.bucketName
                ?? await context.params.get(`s3Bucket${cap}`, "string"),
            region: options.region
                ?? await context.params.get(`s3Region${cap}`, "string default us-east-1"),
            endpoint: options.endpoint
                ?? await context.params.get(`s3Endpoint${cap}`, "string"),
            forcePathStyle: options.forcePathStyle
                ?? await context.params.get(`s3ForcePathStyle${cap}`, "boolean default false"),
            accessKeyId: options.accessKeyId
                ?? await context.params.get(`s3AccessKeyId${cap}`, "string"),
            secretAccessKey: options.secretAccessKey
                ?? await context.params.get(`s3SecretAccessKey${cap}`, "string"),
        };

        if (!config.bucketName) {
            throw new ParamError(
                `S3: bucket name not configured for profile "${profile}" `
                + `(set s3Bucket${cap} or S3_BUCKET_${profile.toUpperCase()})`
            );
        }

        const s3 = new S3(context, config);

        if (options.testBucket !== false) {
            try {
                await s3.bucketExists();
                context.logger?.debug?.(
                    `[S3] profile="${profile}" bucket="${config.bucketName}" reachable`
                );
            } catch (err) {
                context.logger?.warn?.(
                    `[S3] profile="${profile}" bucket="${config.bucketName}" `
                    + `reachability test failed: ${err?.message ?? err}`
                );
            }
        }

        return s3;
    }

    constructor(context, config) {
        this.logger = context?.logger ?? console;
        this.profile = config.profile;
        this.bucketName = config.bucketName;
        this.region = config.region;
        this.endpoint = config.endpoint || null;

        const clientConfig = { region: config.region };
        if (config.endpoint) clientConfig.endpoint = config.endpoint;
        if (config.forcePathStyle) clientConfig.forcePathStyle = true;
        if (config.accessKeyId && config.secretAccessKey) {
            clientConfig.credentials = {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            };
        }

        // Silence the AWS SDK v3 "node >=22 required after Jan 2027" notice on
        // older Node. Honors an explicit env value if the user already set one.
        process.env.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED ??= "true";

        this.client = new S3Client(clientConfig);
    }

    // ── info ────────────────────────────────────────────────────────────────
    getBucketName() { return this.bucketName; }
    getProfile()    { return this.profile; }
    getRegion()     { return this.region; }
    getEndpoint()   { return this.endpoint; }

    // ── reachability ────────────────────────────────────────────────────────
    async bucketExists() {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
        return true;
    }

    // ── HEAD / GET ──────────────────────────────────────────────────────────
    /** Returns null on 404; never throws for "missing". Other errors throw. */
    async headObject(key) {
        try {
            const out = await this.client.send(new HeadObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            }));
            return {
                etag: out.ETag,
                size: out.ContentLength,
                contentType: out.ContentType,
                lastModified: out.LastModified,
                metadata: out.Metadata,
                storageClass: out.StorageClass,
            };
        } catch (err) {
            if (this._isNotFound(err)) return null;
            throw err;
        }
    }

    /** Returns { body: Readable, contentType, contentLength, etag, ... } or null on 404. */
    async getObject(key) {
        try {
            const out = await this.client.send(new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            }));
            return {
                body: out.Body,
                contentType: out.ContentType,
                contentLength: out.ContentLength,
                etag: out.ETag,
                lastModified: out.LastModified,
                metadata: out.Metadata,
            };
        } catch (err) {
            if (this._isNotFound(err)) return null;
            throw err;
        }
    }

    /** Buffers the whole object. Use only for small objects (manifests, JSON). */
    async getObjectBytes(key) {
        const obj = await this.getObject(key);
        if (!obj) return null;
        const chunks = [];
        for await (const chunk of obj.body) chunks.push(chunk);
        return { ...obj, body: Buffer.concat(chunks) };
    }

    /** Convenience for JSON manifests. Returns parsed object or null on 404. */
    async getJson(key) {
        const obj = await this.getObjectBytes(key);
        if (!obj) return null;
        return JSON.parse(obj.body.toString("utf8"));
    }

    // ── PUT ─────────────────────────────────────────────────────────────────
    async putObject({ key, body, contentType, contentLength, tags, metadata }) {
        const cmd = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: body,
            ...(contentType && { ContentType: contentType }),
            ...(contentLength != null && { ContentLength: contentLength }),
            ...(metadata && { Metadata: metadata }),
            ...(tags && { Tagging: this._tagsToQuery(tags) }),
        });
        return this.client.send(cmd);
    }

    /** Convenience for JSON manifests. */
    async putJson(key, value, opts = {}) {
        const json = JSON.stringify(value, null, opts.pretty ? 2 : 0);
        const body = Buffer.from(json, "utf8");
        return this.putObject({
            key,
            body,
            contentType: "application/json",
            contentLength: body.length,
            tags: opts.tags,
            metadata: opts.metadata,
        });
    }

    // ── DELETE ──────────────────────────────────────────────────────────────
    async deleteObject(key) {
        return this.client.send(new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        }));
    }

    // ── COPY (for migration: legacy → new bucket, or intra-bucket "rename") ─
    async copyObject({ sourceBucket, sourceKey, key, contentType, metadata, tags }) {
        const src = sourceBucket || this.bucketName;
        const cmd = new CopyObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            CopySource: encodeURIComponent(`${src}/${sourceKey}`),
            ...(contentType && {
                ContentType: contentType,
                MetadataDirective: "REPLACE",
            }),
            ...(metadata && {
                Metadata: metadata,
                MetadataDirective: "REPLACE",
            }),
            ...(tags && {
                Tagging: this._tagsToQuery(tags),
                TaggingDirective: "REPLACE",
            }),
        });
        return this.client.send(cmd);
    }

    // ── LIST ────────────────────────────────────────────────────────────────
    async listObjects(prefix, { keysOnly = false, maxKeys = 1000, continuationToken } = {}) {
        const out = await this.client.send(new ListObjectsV2Command({
            Bucket: this.bucketName,
            Prefix: prefix,
            MaxKeys: maxKeys,
            ContinuationToken: continuationToken,
        }));
        const items = (out.Contents ?? []).map(o => ({
            key: o.Key,
            size: o.Size,
            etag: o.ETag,
            lastModified: o.LastModified,
            storageClass: o.StorageClass,
        }));
        return {
            items: keysOnly ? items.map(i => i.key) : items,
            isTruncated: !!out.IsTruncated,
            nextContinuationToken: out.NextContinuationToken,
        };
    }

    // ── TAGS (used for lifecycle rules, e.g. status=closed → Glacier IR) ────
    async putObjectTagging(key, tags) {
        return this.client.send(new PutObjectTaggingCommand({
            Bucket: this.bucketName,
            Key: key,
            Tagging: { TagSet: this._tagsToTagSet(tags) },
        }));
    }

    async getObjectTagging(key) {
        const out = await this.client.send(new GetObjectTaggingCommand({
            Bucket: this.bucketName,
            Key: key,
        }));
        const tags = {};
        for (const t of out.TagSet ?? []) tags[t.Key] = t.Value;
        return tags;
    }

    // ── internals ───────────────────────────────────────────────────────────
    _isNotFound(err) {
        const status = err?.$metadata?.httpStatusCode;
        return status === 404
            || err?.name === "NotFound"
            || err?.name === "NoSuchKey"
            || err?.Code === "NoSuchKey";
    }

    _tagsToQuery(tags) {
        return Object.entries(tags)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join("&");
    }

    _tagsToTagSet(tags) {
        return Object.entries(tags).map(([Key, Value]) => ({ Key, Value: String(Value) }));
    }
}
