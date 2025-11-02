import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Args, init, getArgsInstance } from "../index.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Args CI", () => {
    let tmpDir: string;
    let cwdBackup: string;
    let envBackup: Record<string, string | undefined>;
    let argvBackup: string[];

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "args-ci-"));
        cwdBackup = process.cwd();
        process.chdir(tmpDir);
        envBackup = { ...process.env };
        argvBackup = [...process.argv];
    });

    afterEach(() => {
        process.chdir(cwdBackup);
        rmSync(tmpDir, { recursive: true, force: true });

        Object.keys(process.env).forEach((key) => {
            if (!(key in envBackup)) {
                delete process.env[key];
            }
        });
        Object.entries(envBackup).forEach(([key, value]) => {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        });

        process.argv = argvBackup;
    });

    it("honours precedence across CLI args, config files, env vars, and defaults", () => {
        writeFileSync("app.js", "module.exports = { configKey: 'base', baseOnly: true };");
        writeFileSync("app.local.js", "module.exports = { configKey: 'env', envOnly: true };");
        writeFileSync("extra.json", JSON.stringify({ jsonKey: "fromJson" }));
        writeFileSync("extra.local.json", JSON.stringify({ jsonKey: "fromJsonEnv" }));
        writeFileSync(".env.local", "DOTENV_VALUE=fromDotEnv\nFEATURE_LOCAL=fromDotEnv\n");
        writeFileSync(".env", "DOTENV_FALLBACK=fallback\n");

        process.env.CUSTOM_VALUE = "fromEnv";
        process.env.FEATURE_LOCAL = "fromEnvVar";

        const args = new Args({
            args: [
                "--env=local",
                "--config=app,extra.json",
                `--dotEnvPath=${process.cwd()}`,
                "--feature_local=enabled",
                "--booleanFlag",
                "--camelCase=Value",
                "--quoted=\"Hello\"",
                "--not-debug",
                "-o=result.txt",
                "-v",
                "-n",
                "42",
                "-xec=9",
                "-yz",
                "deploy"
            ],
            aliases: { v: "verbose", o: "output", n: "number", x: "execute", e: "enable", c: "count" },
            overrides: { overrideOnly: "override" },
            defaults: { defaultOnly: "fromDefault", configKey: "fromDefault" }
        });

        expect(process.env.DOTENV_VALUE).toBe("fromDotEnv");
        expect(args.get("overrideOnly")).toBe("override");
        expect(args.get("output")).toBe("result.txt");
        expect(args.get("verbose")).toBe(true);
        expect(args.get("number")).toBe("42");
        expect(args.get("count")).toBe("9");
        expect(args.get("execute")).toBe(true);
        expect(args.get("enable")).toBe(true);
        expect(args.get("booleanFlag")).toBe(true);
        expect(args.get("feature")).toBe("enabled");
        expect(args.get("debug")).toBe(false);
        expect(args.get("camelCase")).toBe("Value");
        expect(args.get("quoted")).toBe("Hello");
        expect(args.get("configKey")).toBe("env");
        expect(args.get("jsonKey")).toBe("fromJsonEnv");
        expect(args.get("baseOnly")).toBe(true);
        expect(args.get("envOnly")).toBe(true);
        expect(args.get("defaultOnly")).toBe("fromDefault");
        expect(args.get("customValue")).toBe("fromEnv");
        expect(args.get("dotEnvPath")).toBe(process.cwd());
        expect(args.get("env")).toBe("local");

        args.set("manualkey", "manualValue");
        expect(args.get("manualkey")).toBe("manualValue");

        expect(args.hasCommand("DEPLOY")).toBe(true);
        expect(args.getCommands()).toEqual(["deploy"]);

        const parsed = args.getParsed();
        expect(parsed.command).toBe("deploy");
        expect(parsed.flags.verbose).toBe(true);
        expect(parsed.flags.execute).toBe(true);
        expect(parsed.options.output).toBe("result.txt");
        expect(parsed.options.count).toBe("9");
        expect(Array.from(parsed.usedKeys)).toContain("output");

        const used = args.getUsed();
        expect(used).toEqual(expect.arrayContaining(["output", "configKey", "customValue"]));

        const unused = args.getUnused();
        expect(unused).toEqual(expect.arrayContaining(["y", "z", "feature_local"]));
    });

    it("loads custom dotenv file when explicitly provided", () => {
        writeFileSync(".customenv", "CUSTOM_DOT=custom\n");

        const args = new Args({
            args: [
                "--env=local",
                `--dotEnvPath=${process.cwd()}`,
                "--dotEnvFile=.customenv"
            ]
        });

        expect(process.env.CUSTOM_DOT).toBe("custom");
        expect(args.get("dotEnvFile")).toBe(".customenv");
    });

    it("redefines negative prefixes and re-parses process argv", () => {
        process.argv = ["node", "test", "--never-debug"];

        const args = new Args({ args: [] });
        args.setPrefixes("never");

        expect(args.get("debug")).toBe(false);
        expect(args.getUsed()).toContain("debug");
    });

    it("throws when short and long aliases are both provided", () => {
        const args = new Args({ args: [] }) as any;
        args.aliases = { v: "verbose" };
        args.args = { v: true, verbose: true };
        expect(() => args.checkConflicts()).toThrow(/Both -v and --verbose specified/i);
    });

    it("throws when configuration files cannot be located", () => {
        expect(() => new Args({
            args: ["--config=missing"],
            defaults: {}
        })).toThrow(/can't load config file/i);
    });

    it("throws when configuration file uses unsupported extension", () => {
        writeFileSync("bad.txt", "value");

        expect(() => new Args({
            args: ["--config=bad.txt"],
            defaults: {}
        })).toThrow(/can't load config file/i);
    });

    it("throws when JS configuration file fails to load", () => {
        writeFileSync("bad.js", "module.exports =");

        expect(() => new Args({
            args: ["--config=bad"],
            defaults: {}
        })).toThrow(/can't load config file/i);
    });

    it("falls back to NODE_ENV when env flag is missing", () => {
        process.env.NODE_ENV = "staging";

        const args = new Args({ args: [] });
        expect(args.get("env")).toBe("staging");
    });

    it("exposes singleton helpers", () => {
        const argsInstance = init(["build"]);
        expect(getArgsInstance()).toBe(argsInstance);
        expect(argsInstance.getCommands()).toEqual(["build"]);
    });
});


