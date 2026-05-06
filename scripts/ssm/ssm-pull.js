#!/usr/bin/env node
/**
 * Pull all SSM parameters under a path (recursive) for use on servers or locally.
 * Uses default credential chain (on EC2: instance profile; e.g. mlsfarm tf3 `04.4.ssm_iam.tf`).
 *
 * Output modes:
 *   print   — table to stdout (default)
 *   dotenv  — KEY=value lines (dotenv-friendly; optional --file)
 *   shell   — export KEY='...' lines for: eval "$(npx tsx ... --output shell)"
 *
 * Env key = last path segment of the parameter name (e.g. /mlsfarm/tf3/DATABASE_URL → DATABASE_URL).
 *
 * From package root:
 *
 *   npx tsx scripts/ssm/ssm-pull.js --path /mlsfarm/tf3/
 *   npm run ssm:pull -- --path /mlsfarm/tf3/ --output dotenv --file .env.from-ssm
 *   eval "$(npx tsx scripts/ssm/ssm-pull.js --path /mlsfarm/tf3/ --output shell)"
 */

import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { writeFileSync } from "fs";
import { parseCli, getRegion } from "./parse-cli.js";

function ensureLeadingSlash(path) {
    const p = path.trim();
    if (!p.startsWith("/")) return `/${p}`;
    return p.endsWith("/") ? p : `${p}/`;
}

function leafKey(paramName) {
    const trimmed = paramName.replace(/^\/+|\/+$/g, "");
    const parts = trimmed.split("/");
    const leaf = parts[parts.length - 1] || trimmed;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(leaf)) {
        return leaf.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^(\d)/, "_$1");
    }
    return leaf;
}

function escapeDotenvValue(value) {
    if (/[\s#'"]/u.test(value) || value.includes("\n")) {
        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        return `"${escaped}"`;
    }
    return value;
}

function escapeShellSingleQuoted(value) {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function fetchAll(client, path) {
    const outList = [];
    let next;
    do {
        const out = await client.send(
            new GetParametersByPathCommand({
                Path: path,
                Recursive: true,
                WithDecryption: true,
                NextToken: next,
            })
        );
        for (const p of out.Parameters || []) {
            if (p.Name && p.Value !== undefined) {
                outList.push({ name: p.Name, value: p.Value, type: p.Type });
            }
        }
        next = out.NextToken;
    } while (next);
    outList.sort((a, b) => a.name.localeCompare(b.name));
    return outList;
}

async function main() {
    const { flags } = parseCli(process.argv.slice(2));
    const pathRaw = flags.path;
    if (typeof pathRaw !== "string" || !pathRaw.trim()) {
        console.error("Required: --path /your/prefix/");
        process.exit(1);
    }
    const path = ensureLeadingSlash(pathRaw);
    const output = String(flags.output || "print").toLowerCase();
    const file = typeof flags.file === "string" ? flags.file : undefined;

    const region = typeof flags.region === "string" ? flags.region : getRegion();
    const client = new SSMClient({ region });

    const params = await fetchAll(client, path);
    if (params.length === 0) {
        const msg = `(no parameters under ${path})`;
        if (file) writeFileSync(file, "", "utf8");
        else console.log(msg);
        return;
    }

    if (output === "print") {
        const lines = [
            `region=${region} path=${path} count=${params.length}`,
            "",
            ...params.map((p) => {
                const k = leafKey(p.name);
                const preview =
                    p.value.length > 120 ? `${p.value.slice(0, 117)}...` : p.value;
                return `${p.name}  [${k}]  (${p.type})  ${preview}`;
            }),
        ];
        const text = lines.join("\n");
        if (file) writeFileSync(file, text + "\n", "utf8");
        else console.log(text);
        return;
    }

    if (output === "dotenv") {
        const body = params
            .map((p) => {
                const k = leafKey(p.name);
                return `${k}=${escapeDotenvValue(p.value)}`;
            })
            .join("\n");
        const text = `${body}\n`;
        if (file) writeFileSync(file, text, "utf8");
        else process.stdout.write(text);
        return;
    }

    if (output === "shell") {
        const body = params
            .map((p) => {
                const k = leafKey(p.name);
                return `export ${k}=${escapeShellSingleQuoted(p.value)}`;
            })
            .join("\n");
        const text = `${body}\n`;
        if (file) writeFileSync(file, text, "utf8");
        else process.stdout.write(text);
        return;
    }

    console.error(`Unknown --output ${output}. Use: print | dotenv | shell`);
    process.exit(1);
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
