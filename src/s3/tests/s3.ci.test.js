import { describe, expect, it, vi } from "vitest";
import { ParamError } from "../../errors.js";
import { S3 } from "../index.js";

function fakeParams(values) {
    return {
        getAllForModule: () => ({ bucket: values.bucket }),
        get: async (key, spec) => {
            if (key in values) return values[key];
            if (typeof spec === "string" && spec.includes("default ")) {
                const def = spec.split("default ")[1];
                if (spec.startsWith("boolean")) return def === "true";
                return def;
            }
            return undefined;
        },
    };
}

function makeS3(overrides = {}) {
    const s3 = new S3(
        { logger: { debug: vi.fn(), warn: vi.fn() } },
        {
            profile: "local",
            bucketName: "photos-local",
            region: "us-east-1",
            endpoint: "http://localhost:9000",
            forcePathStyle: true,
            accessKeyId: "dev",
            secretAccessKey: "devdev",
            ...overrides,
        },
    );
    return s3;
}

describe("S3", () => {
    it("init requires a bucket name and skips the reachability ping when asked", async () => {
        await expect(
            S3.init({ params: fakeParams({ bucket: "local" }), logger: {} }, { testBucket: false }),
        ).rejects.toBeInstanceOf(ParamError);

        const s3 = await S3.init(
            {
                params: fakeParams({
                    bucket: "local",
                    s3BucketLocal: "photos-local",
                    s3RegionLocal: "us-east-1",
                    s3EndpointLocal: "http://localhost:9000",
                    s3ForcePathStyleLocal: true,
                    s3AccessKeyIdLocal: "dev",
                    s3SecretAccessKeyLocal: "devdev",
                }),
                logger: { debug: vi.fn(), warn: vi.fn() },
            },
            { testBucket: false },
        );
        expect(s3.getBucketName()).toBe("photos-local");
        expect(s3.getProfile()).toBe("local");
        expect(s3.getRegion()).toBe("us-east-1");
        expect(s3.getEndpoint()).toBe("http://localhost:9000");
    });

    it("bucketExists sends HeadBucket", async () => {
        const s3 = makeS3();
        s3.client.send = vi.fn(async () => ({}));
        expect(await s3.bucketExists()).toBe(true);
        expect(s3.client.send).toHaveBeenCalled();
    });

    it("head/get treat 404 as null and buffer JSON", async () => {
        const s3 = makeS3();
        s3.client.send = vi.fn(async (cmd) => {
            const name = cmd.constructor.name;
            if (name === "HeadObjectCommand" && cmd.input.Key === "missing") {
                const err = new Error("missing");
                err.name = "NotFound";
                err.$metadata = { httpStatusCode: 404 };
                throw err;
            }
            if (name === "HeadObjectCommand") {
                return {
                    ETag: '"abc"',
                    ContentLength: 3,
                    ContentType: "text/plain",
                    LastModified: new Date("2024-01-01"),
                    Metadata: { k: "v" },
                    StorageClass: "STANDARD",
                };
            }
            if (name === "GetObjectCommand" && cmd.input.Key === "gone") {
                const err = new Error("gone");
                err.Code = "NoSuchKey";
                throw err;
            }
            if (name === "GetObjectCommand") {
                return {
                    Body: (async function* () {
                        yield Buffer.from('{"ok":');
                        yield Buffer.from("true}");
                    })(),
                    ContentType: "application/json",
                    ContentLength: 11,
                    ETag: '"j"',
                    LastModified: new Date("2024-01-02"),
                    Metadata: {},
                };
            }
            throw new Error(`unexpected ${name}`);
        });

        expect(await s3.headObject("missing")).toBe(null);
        expect(await s3.headObject("present")).toMatchObject({ etag: '"abc"', size: 3 });
        expect(await s3.getObject("gone")).toBe(null);
        expect(await s3.getJson("manifest.json")).toEqual({ ok: true });
        expect(await s3.getObjectBytes("gone")).toBe(null);
    });

    it("put/delete/copy/list/tag helpers send the right commands", async () => {
        const s3 = makeS3();
        const sent = [];
        s3.client.send = vi.fn(async (cmd) => {
            sent.push(cmd.constructor.name);
            if (cmd.constructor.name === "ListObjectsV2Command") {
                return {
                    Contents: [{ Key: "a.json", Size: 1, ETag: '"1"', LastModified: new Date(), StorageClass: "STANDARD" }],
                    IsTruncated: false,
                };
            }
            if (cmd.constructor.name === "GetObjectTaggingCommand") {
                return { TagSet: [{ Key: "status", Value: "closed" }] };
            }
            return {};
        });

        await s3.putJson("m.json", { a: 1 }, { pretty: true, tags: { k: "v" }, metadata: { m: "1" } });
        await s3.deleteObject("m.json");
        await s3.copyObject({
            sourceBucket: "other",
            sourceKey: "old.json",
            key: "new.json",
            contentType: "application/json",
            metadata: { m: "2" },
            tags: { t: "1" },
        });
        const listed = await s3.listObjects("pref/", { keysOnly: true });
        expect(listed.items).toEqual(["a.json"]);
        await s3.putObjectTagging("m.json", { status: "closed" });
        expect(await s3.getObjectTagging("m.json")).toEqual({ status: "closed" });
        expect(sent).toContain("PutObjectCommand");
        expect(sent).toContain("DeleteObjectCommand");
        expect(sent).toContain("CopyObjectCommand");
        expect(sent).toContain("ListObjectsV2Command");
        expect(sent).toContain("PutObjectTaggingCommand");
        expect(sent).toContain("GetObjectTaggingCommand");
    });

    it("rethrows non-404 head/get errors", async () => {
        const s3 = makeS3();
        s3.client.send = vi.fn(async () => {
            const err = new Error("denied");
            err.name = "AccessDenied";
            err.$metadata = { httpStatusCode: 403 };
            throw err;
        });
        await expect(s3.headObject("x")).rejects.toThrow("denied");
        await expect(s3.getObject("x")).rejects.toThrow("denied");
    });
});
