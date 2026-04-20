/**
 * Minimal argv parser: supports --key=value and --key value (boolean if no value).
 */
export function parseCli(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
    const flags: Record<string, string | boolean> = {};
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) {
            rest.push(a);
            continue;
        }
        const body = a.slice(2);
        if (body.includes("=")) {
            const eq = body.indexOf("=");
            const k = body.slice(0, eq);
            const v = body.slice(eq + 1);
            flags[k] = v;
            continue;
        }
        const k = body;
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            flags[k] = next;
            i++;
        } else {
            flags[k] = true;
        }
    }
    return { _: rest, flags };
}

export function getRegion(): string {
    return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ca-central-1";
}
