#!/usr/bin/env node
/**
 * cli-aws-discover — read-only peek at the AWS account behind your credentials.
 *
 * Once @nmakarov/cli-toolkit is installed, run it without copying anything:
 *
 *   npx cli-aws-discover
 *   npx cli-aws-discover --awsRegion=ca-central-1
 *
 * Credentials/region resolve from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
 * AWS_REGION (env or .env), an AWS_PROFILE, or an instance role. If none are
 * found — or AWS rejects them — it prints exactly how to get a key, no stack trace.
 *
 * Handy for finding the Route53 zone id / VPC / AMI you need for terraform.tfvars.
 */

import { init } from "../../dist/init.js";
import { Aws } from "../../dist/aws.js";

const flow = async (context) => {
    const { logger } = context;
    logger.info("cli-aws-discover — read-only peek at your AWS account");

    const aws = await Aws.init(context);

    const cred = await aws.checkCredentials();
    if (!cred.ok) {
        logger.error(Aws.credentialsHelp(aws.getRegion()));
        process.exitCode = 1;
        return;
    }
    logger.info(`credentials: ${cred.source}`);

    try {
        const me = await aws.whoAmI();
        logger.info(`account  ${me.account}   region ${aws.getRegion()}`);
        logger.info(`identity ${me.arn}`);

        const zones = await aws.listHostedZones();
        logger.info(`\nRoute53 hosted zones (${zones.length}):`);
        for (const z of zones) logger.info(`  ${z.name.padEnd(30)} ${z.id}${z.private ? " [private]" : ""}`);

        const vpcs = await aws.listVpcs();
        logger.info(`\nVPCs (${vpcs.length}):`);
        for (const v of vpcs) logger.info(`  ${v.id}  ${v.cidr}${v.isDefault ? "  default" : ""}  ${v.name ?? ""}`);

        const ami = await aws.findLatestUbuntuAmi();
        logger.info(`\nLatest Ubuntu AMI: ${ami ? `${ami.id}  ${ami.name}` : "(none)"}`);
    } catch (err) {
        if (Aws.isAuthError(err)) {
            logger.error(`AWS rejected the credentials it found (${err.name}).\n`);
            logger.error(Aws.credentialsHelp(aws.getRegion()));
            process.exitCode = 1;
            return;
        }
        throw err;
    }
};

init(flow);
