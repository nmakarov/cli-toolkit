#!/usr/bin/env node
/**
 * AWS discovery demo — read-only inventory of an account from just a key/secret.
 *
 * Set credentials in the environment (or a .env in the cwd):
 *   AWS_ACCESS_KEY_ID=...
 *   AWS_SECRET_ACCESS_KEY=...
 *   AWS_REGION=us-east-1            # optional, default us-east-1
 *
 * Run (from this package root, subprojects/cli-toolkit):
 *   node examples/aws/discover.js
 *   node examples/aws/discover.js --awsRegion=ca-central-1
 *   node examples/aws/discover.js --vpcId=vpc-0123   # scope subnets/SGs
 *
 * It prints: caller identity, regions, AZs, VPCs, subnets, security groups,
 * key pairs, Route53 hosted zones, and the latest Ubuntu AMI. Nothing is created.
 */

import chalk from "chalk";
import { init } from "../../src/init/index.js";
import { Aws } from "../../src/aws/index.js";

const flow = async (context) => {
    const { logger, params } = context;
    const aws = await Aws.init(context);
    const vpcId = await params.get("vpcId", "string");

    logger.info(chalk.yellow(`AWS discovery — region ${aws.getRegion()}`));
    logger.info(chalk.dim("─".repeat(60)));

    const me = await aws.whoAmI();
    logger.info(`${chalk.bold("account")}  ${chalk.cyan(me.account)}`);
    logger.info(`${chalk.bold("arn")}      ${chalk.dim(me.arn)}`);
    logger.info("");

    const zones = await aws.listHostedZones();
    logger.info(chalk.bold.green(`Route53 hosted zones (${zones.length})`));
    for (const z of zones) {
        logger.info(`  ${chalk.cyan(z.name.padEnd(30))} ${z.id}  ${z.private ? chalk.magenta("(private)") : ""}`);
    }
    logger.info("");

    const vpcs = await aws.listVpcs();
    logger.info(chalk.bold.green(`VPCs (${vpcs.length})`));
    for (const v of vpcs) {
        logger.info(`  ${chalk.cyan(v.id)}  ${v.cidr.padEnd(18)} ${v.isDefault ? chalk.yellow("default") : ""} ${v.name ?? ""}`);
    }
    logger.info("");

    const subnets = await aws.listSubnets({ vpcId });
    logger.info(chalk.bold.green(`Subnets${vpcId ? ` in ${vpcId}` : ""} (${subnets.length})`));
    for (const s of subnets) {
        logger.info(`  ${chalk.cyan(s.id)}  ${s.az.padEnd(16)} ${s.cidr.padEnd(18)} ${s.public ? chalk.green("public") : chalk.dim("private")} ${s.name ?? ""}`);
    }
    logger.info("");

    const sgs = await aws.listSecurityGroups({ vpcId });
    logger.info(chalk.bold.green(`Security groups${vpcId ? ` in ${vpcId}` : ""} (${sgs.length})`));
    for (const g of sgs) {
        logger.info(`  ${chalk.cyan(g.id)}  ${(g.name ?? "").padEnd(24)} ${chalk.dim(g.description ?? "")}`);
    }
    logger.info("");

    const keys = await aws.listKeyPairs();
    logger.info(chalk.bold.green(`EC2 key pairs (${keys.length})`));
    for (const k of keys) logger.info(`  ${chalk.cyan(k.name)}  ${chalk.dim(k.fingerprint ?? "")}`);
    logger.info("");

    const azs = await aws.listAvailabilityZones();
    logger.info(`${chalk.bold.green("AZs")} ${azs.join(", ")}`);

    const ami = await aws.findLatestUbuntuAmi();
    logger.info(chalk.bold.green("Latest Ubuntu AMI"));
    if (ami) logger.info(`  ${chalk.cyan(ami.id)}  ${chalk.dim(ami.name)}`);
    else logger.info(chalk.dim("  (none found)"));
    logger.info("");

    const regions = await aws.listRegions();
    logger.info(`${chalk.bold.green(`Enabled regions (${regions.length})`)} ${chalk.dim(regions.join(", "))}`);

    logger.info("");
    logger.info(chalk.green("done — read-only, nothing was modified"));
};

init(flow);
