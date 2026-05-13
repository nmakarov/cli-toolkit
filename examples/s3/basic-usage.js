#!/usr/bin/env node

/**
 * S3 Basic Usage – init, put/get/head/list/tag/delete with profile switching.
 *
 * Profile is selected via --bucket=<profile>. Defaults to "local".
 *
 * Local (MinIO via docker-compose at the project root):
 *   docker compose up -d minio minio-init
 *   # Ensure env vars are loaded (root .env.example shows S3_*_LOCAL keys).
 *   npx tsx examples/s3/basic-usage.js
 *
 * Production / staging (real AWS — buckets created by tf3/05.3.s3_photos.tf):
 *   npx tsx examples/s3/basic-usage.js --bucket=stage
 *   npx tsx examples/s3/basic-usage.js --bucket=prod
 *
 * Override anything ad-hoc:
 *   npx tsx examples/s3/basic-usage.js --bucket=local --s3BucketLocal=other-bucket
 *
 * Required env (per profile, see root .env.example):
 *   S3_BUCKET_<PROFILE>            (required)
 *   S3_REGION_<PROFILE>            (default us-east-1)
 *   S3_ENDPOINT_<PROFILE>          (set for MinIO/local; unset for real AWS)
 *   S3_FORCE_PATH_STYLE_<PROFILE>  (true for MinIO)
 *   S3_ACCESS_KEY_ID_<PROFILE>     (omit on EC2 to use instance profile)
 *   S3_SECRET_ACCESS_KEY_<PROFILE>
 */

import chalk from "chalk";
import { init } from "../../src/init/index.js";
import { S3 } from "../../src/s3/index.js";

const flow = async (context) => {
    const { logger } = context;

    logger.info(chalk.yellow("S3 Basic Usage"));
    logger.info(chalk.dim("─".repeat(50)));

    const s3 = await S3.init(context);

    logger.info(`profile=${chalk.cyan(s3.getProfile())}`);
    logger.info(`bucket =${chalk.cyan(s3.getBucketName())}`);
    logger.info(`region =${chalk.cyan(s3.getRegion())}`);
    logger.info(`endpoint=${chalk.cyan(s3.getEndpoint() ?? "(default AWS)")}`);
    logger.info("");

    // 1. Reachability sanity (already done by init when testBucket != false)
    logger.info(chalk.bold.green("✓ 1. bucketExists()"));
    try {
        await s3.bucketExists();
        logger.info(chalk.green("   bucket reachable"));
    } catch (err) {
        logger.error(chalk.red(`   bucket NOT reachable: ${err.message}`));
        logger.error(chalk.yellow("   for local: 'docker compose up -d minio minio-init'"));
        logger.error(chalk.yellow("   for prod/stage: check AWS credentials and bucket existence"));
        return;
    }
    logger.info("");

    // Use a unique key prefix so concurrent runs of the example don't collide.
    const runId = `example-run-${Date.now()}`;
    const photoKey = `${runId}/property/sample/0.jpg`;
    const manifestKey = `${runId}/property/sample/index.json`;

    // 2. Put an object (fake "photo" — just bytes)
    logger.info(chalk.bold.green(`✓ 2. putObject(${photoKey})`));
    const fakePhoto = Buffer.from("fake-jpeg-bytes-for-testing");
    await s3.putObject({
        key: photoKey,
        body: fakePhoto,
        contentType: "image/jpeg",
        contentLength: fakePhoto.length,
        tags: { status: "active", source: "example" },
    });
    logger.info(chalk.dim(`   wrote ${fakePhoto.length} bytes`));
    logger.info("");

    // 3. Put a JSON manifest beside it
    logger.info(chalk.bold.green(`✓ 3. putJson(${manifestKey})`));
    await s3.putJson(manifestKey, {
        source: "example",
        entity: "property",
        uuid: "sample",
        photos: [
            {
                index: 0,
                storage: { bucket: s3.getBucketName(), key: photoKey },
                content_type: "image/jpeg",
                size: fakePhoto.length,
                fetched_at: new Date().toISOString(),
                status: "active",
            },
        ],
    }, { pretty: true });
    logger.info(chalk.dim("   manifest written"));
    logger.info("");

    // 4. headObject — metadata only
    logger.info(chalk.bold.green(`✓ 4. headObject(${photoKey})`));
    const head = await s3.headObject(photoKey);
    logger.info(chalk.dim(`   etag=${head.etag} size=${head.size} ct=${head.contentType}`));
    logger.info("");

    // 5. headObject on missing key → null (no throw)
    logger.info(chalk.bold.green("✓ 5. headObject(missing-key) → null"));
    const missing = await s3.headObject(`${runId}/does-not-exist`);
    logger.info(chalk.dim(`   result=${missing}`));
    logger.info("");

    // 6. getJson
    logger.info(chalk.bold.green(`✓ 6. getJson(${manifestKey})`));
    const manifest = await s3.getJson(manifestKey);
    logger.info(chalk.dim(`   parsed: ${manifest.photos.length} photo(s)`));
    logger.info("");

    // 7. getObjectBytes (small objects only — buffers everything)
    logger.info(chalk.bold.green(`✓ 7. getObjectBytes(${photoKey})`));
    const got = await s3.getObjectBytes(photoKey);
    logger.info(chalk.dim(`   read ${got.body.length} bytes (matches: ${got.body.equals(fakePhoto)})`));
    logger.info("");

    // 8. listObjects under the run prefix
    logger.info(chalk.bold.green(`✓ 8. listObjects(${runId}/)`));
    const list = await s3.listObjects(`${runId}/`);
    logger.info(chalk.dim(`   ${list.items.length} object(s):`));
    for (const item of list.items) {
        logger.info(chalk.dim(`     ${item.key}  (${item.size}b)`));
    }
    logger.info("");

    // 9. Tag the photo as closed (the lifecycle rule on prod would push to GIR)
    logger.info(chalk.bold.green(`✓ 9. putObjectTagging(${photoKey}, { status: closed })`));
    await s3.putObjectTagging(photoKey, { status: "closed", source: "example" });
    const tags = await s3.getObjectTagging(photoKey);
    logger.info(chalk.dim(`   tags=${JSON.stringify(tags)}`));
    logger.info("");

    // 10. Cleanup
    logger.info(chalk.bold.yellow("✓ 10. cleanup"));
    await s3.deleteObject(photoKey);
    await s3.deleteObject(manifestKey);
    logger.info(chalk.dim("   deleted both objects"));
    logger.info("");

    logger.info(chalk.green("S3 demonstration completed"));
};

init(flow);
