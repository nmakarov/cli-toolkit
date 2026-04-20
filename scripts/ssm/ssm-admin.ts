#!/usr/bin/env node
/**
 * Local admin CLI for SSM Parameter Store (uses your workstation AWS credentials / profile).
 *
 * Prerequisites: IAM permission for ssm:Get*, ssm:PutParameter, ssm:DeleteParameter on your parameters
 * (and kms:Decrypt/Encrypt if you use SecureString).
 *
 * Run from this package root (`subprojects/cli-toolkit`):
 *
 *   npx tsx scripts/ssm/ssm-admin.ts list --prefix /mlsfarm/tf3/
 *   npm run ssm:list -- --prefix /mlsfarm/tf3/
 *
 * Or from a project that depends on `@nmakarov/cli-toolkit` (after a release that ships `scripts/ssm/`):
 *
 *   npx tsx node_modules/@nmakarov/cli-toolkit/scripts/ssm/ssm-admin.ts list --prefix /mlsfarm/tf3/
 *
 * Optional: AWS_REGION, AWS_PROFILE (standard SDK env).
 */

import {
    SSMClient,
    GetParametersByPathCommand,
    GetParameterCommand,
    PutParameterCommand,
    DeleteParameterCommand,
} from "@aws-sdk/client-ssm";
import { parseCli, getRegion } from "./parse-cli.js";

function usage(): void {
    console.error(`Usage:
  npx tsx scripts/ssm/ssm-admin.ts list   --prefix /path/ [--recursive false]
  npx tsx scripts/ssm/ssm-admin.ts get    --name /path/KEY
  npx tsx scripts/ssm/ssm-admin.ts put    --name /path/KEY --value "..." [--type String|SecureString] [--overwrite]
  npx tsx scripts/ssm/ssm-admin.ts delete --name /path/KEY`);
}

function ensureLeadingSlash(path: string): string {
    const p = path.trim();
    if (!p.startsWith("/")) return `/${p}`;
    return p;
}

async function main(): Promise<void> {
    const { _, flags } = parseCli(process.argv.slice(2));
    const cmd = (_[0] || "").toLowerCase();
    if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
        usage();
        process.exit(cmd ? 0 : 1);
    }

    const region = typeof flags.region === "string" ? flags.region : getRegion();
    const client = new SSMClient({ region });

    if (cmd === "list") {
        const prefix = ensureLeadingSlash(String(flags.prefix || "/mlsfarm/tf3/"));
        const recursive = flags.recursive === false || flags.recursive === "false" ? false : true;
        let next: string | undefined;
        const rows: { name?: string; type?: string; version?: number }[] = [];
        do {
            const out = await client.send(
                new GetParametersByPathCommand({
                    Path: prefix,
                    Recursive: recursive,
                    WithDecryption: true,
                    NextToken: next,
                })
            );
            for (const p of out.Parameters || []) {
                rows.push({ name: p.Name, type: p.Type, version: p.Version });
            }
            next = out.NextToken;
        } while (next);

        if (rows.length === 0) {
            console.log(`(no parameters under ${prefix})`);
            return;
        }
        const w = Math.max(...rows.map((r) => (r.name || "").length), 4);
        console.log(`${"NAME".padEnd(w)}  TYPE            VER`);
        for (const r of rows) {
            console.log(`${(r.name || "").padEnd(w)}  ${(r.type || "").padEnd(14)} ${r.version ?? ""}`);
        }
        return;
    }

    if (cmd === "get") {
        const name = flags.name;
        if (typeof name !== "string" || !name.trim()) {
            console.error("get: --name is required");
            usage();
            process.exit(1);
        }
        const out = await client.send(
            new GetParameterCommand({ Name: ensureLeadingSlash(name), WithDecryption: true })
        );
        const p = out.Parameter;
        if (!p?.Name) {
            console.error("Parameter not found");
            process.exit(1);
        }
        console.log(`Name:  ${p.Name}`);
        console.log(`Type:  ${p.Type}`);
        console.log(`Value: ${p.Value ?? ""}`);
        return;
    }

    if (cmd === "put") {
        const name = flags.name;
        const value = flags.value;
        if (typeof name !== "string" || !name.trim()) {
            console.error("put: --name is required");
            process.exit(1);
        }
        if (typeof value !== "string") {
            console.error("put: --value is required (string)");
            process.exit(1);
        }
        const type = (flags.type as string) === "SecureString" ? "SecureString" : "String";
        const overwrite = flags.overwrite === true || flags.overwrite === "true";
        const ver = await client.send(
            new PutParameterCommand({
                Name: ensureLeadingSlash(name),
                Value: value,
                Type: type,
                Overwrite: overwrite,
            })
        );
        console.log(`OK Version ${ver.Version}`);
        return;
    }

    if (cmd === "delete") {
        const name = flags.name;
        if (typeof name !== "string" || !name.trim()) {
            console.error("delete: --name is required");
            process.exit(1);
        }
        await client.send(new DeleteParameterCommand({ Name: ensureLeadingSlash(name) }));
        console.log("OK deleted");
        return;
    }

    console.error(`Unknown command: ${cmd}`);
    usage();
    process.exit(1);
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
