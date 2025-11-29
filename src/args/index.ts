// Arguments discovery and parsing module
// This module provides utilities for parsing CLI arguments and detecting flags

import { readFileSync, existsSync } from "fs";
import { resolve, dirname, basename, extname, join, isAbsolute } from "path";
import { config } from "dotenv";

export interface ArgsConfig {
    args?: string[]; // Default: process.argv.slice(2)
    aliases?: Record<string, string>; // Short → long mapping
    overrides?: Record<string, any>; // Highest precedence
    defaults?: Record<string, any>; // Lowest precedence
    prefixes?: string[]; // Negative flag prefixes (default: ["not", "no"])
}

export interface ParsedArgs {
    command: string;
    flags: Record<string, boolean>;
    options: Record<string, string>;
    usedKeys: string[];
}

/**
 * Parse command line arguments with support for aliases, overrides, and defaults
 *
 * Precedence order (highest to lowest):
 * 1. Overrides (constructor config)
 * 2. CLI args (command line)
 * 3. Config files (loaded from files)
 * 4. Environment variables (process.env)
 * 5. Defaults (constructor config)
 */
export class Args {
    private args: Record<string, any> = {};
    private flags: Record<string, boolean> = {};
    private options: Record<string, string> = {};
    private commands: string[] = [];
    private usedKeys: Set<string> = new Set();
    private aliases: Record<string, string> = {};
    private overrides: Record<string, any> = {};
    private defaults: Record<string, any> = {};
    private prefixes: string[] = [];
    private nots: string[] = [];
    private configValues: Record<string, any> = {};
    private configsLoaded: string[] = [];
    private env: string = "local";

    constructor(config: ArgsConfig = {}) {
        // Set defaults first
        this.aliases = {};
        this.overrides = {};
        this.defaults = {};
        this.prefixes = ["not", "no"];

        // Apply configuration
        if (Object.keys(config).length > 0) {
            this.configure(config);
        }

        // Parse arguments first to get environment
        const args = config.args || process.argv.slice(2);
        this.parseArgs(args);

        // Set environment from parsed args
        this.env = this.get("env")?.toLowerCase() || "local";

        // Load .env file
        this.loadDotEnv();

        // Load configuration files
        this.loadConfigFiles();

        // Check for conflicts (short + long form of same option)
        this.checkConflicts();
    }

    /**
     * Configure Args options
     * Only parameters present in config are updated
     * Note: Args is special - it's initialized first, so it can't take context
     */
    configure(config: Partial<ArgsConfig>): void {
        if (config.aliases !== undefined) {
            this.aliases = config.aliases;
        }
        if (config.overrides !== undefined) {
            this.overrides = config.overrides;
        }
        if (config.defaults !== undefined) {
            this.defaults = config.defaults;
        }
        if (config.prefixes !== undefined) {
            this.prefixes = config.prefixes;
        }
        // Note: args array can't be reconfigured after construction
    }

    /**
     * Initialize Args instance
     * Note: Args is special - it's initialized first, so it can't take context
     * This static method is for consistency with other components
     */
    static init(config: ArgsConfig = {}): Args {
        return new Args(config);
    }

    /**
     * Parse command line arguments
     */
    private parseArgs(args: string[]): void {
        let i = 0;
        while (i < args.length) {
            const arg = args[i];

            if (arg.startsWith("--")) {
                // Long option: --key=value or --key
                const [key, value] = this.parseLongOption(arg);
                this.setValue(key, value);
                i++;
            } else if (arg.startsWith("-")) {
                // Short option: -k=value, -k, or bundled -vsd
                const result = this.parseShortOption(arg, args, i);
                if (result.consumed > 0) {
                    i += result.consumed;
                } else {
                    i++;
                }
            } else {
                // Command (no prefix)
                this.commands.push(arg);
                i++;
            }
        }
    }

    /**
     * Parse long option (--key=value or --key)
     */
    private parseLongOption(arg: string): [string, string | boolean] {
        const key = arg.slice(2); // Remove '--'

        // Check for negative flags (--no-debug, --not-verbose)
        const prefix = this.prefixes.find((p) => key.startsWith(p));
        if (prefix) {
            let strippedKey = key.slice(prefix.length);
            // Remove leading dash if present
            if (strippedKey.startsWith("-")) {
                strippedKey = strippedKey.slice(1);
            }
            this.nots.push(key);
            return [strippedKey, false];
        }

        if (key.includes("=")) {
            // --key=value - need to handle quoted values properly
            const eqIndex = key.indexOf("=");
            const optionKey = key.slice(0, eqIndex);
            const value = key.slice(eqIndex + 1);
            return [optionKey, this.parseValue(value)];
        } else {
            // --key (boolean flag)
            return [key, true];
        }
    }

    /**
     * Parse short option (-k=value, -k, or bundled -vsd)
     */
    private parseShortOption(arg: string, args: string[], index: number): { consumed: number } {
        const key = arg.slice(1); // Remove '-'

        // Check if it's a single short flag with value (like -vo file.txt)
        if (key.length === 1 && index + 1 < args.length && !args[index + 1].startsWith("-")) {
            // Single short flag with separate value
            const value = args[index + 1];
            this.setValue(key, this.parseValue(value));
            return { consumed: 2 }; // Consumed this flag and the next argument
        }

        // Check if it's a bundled short flags (like -vsd)
        if (key.length > 1 && !key.includes("=")) {
            // Handle bundled flags: -vsd = -v -s -d
            // Process each character, valid ones become flags, invalid ones become unused
            for (let i = 0; i < key.length; i++) {
                const shortKey = key[i];
                if (shortKey in this.aliases) {
                    this.setValue(shortKey, true);
                } else {
                    // Invalid short flag - add to unused keys
                    this.args[shortKey] = true;
                }
            }
            return { consumed: 1 };
        }

        if (key.includes("=")) {
            // -k=value or -vsdk=4 - need to handle quoted values properly
            const eqIndex = key.indexOf("=");
            const optionKey = key.slice(0, eqIndex);
            const value = key.slice(eqIndex + 1);

            // Check if this is a bundled flag with value on the last one (like -vsdk=4)
            if (optionKey.length > 1) {
                // Handle bundled flags with value on the last one: -vsdk=4 = -v -s -d -k=4
                for (let i = 0; i < optionKey.length - 1; i++) {
                    const shortKey = optionKey[i];
                    if (shortKey in this.aliases) {
                        this.setValue(shortKey, true);
                    } else {
                        this.args[shortKey] = true;
                    }
                }
                // Handle the last flag with value
                const lastKey = optionKey[optionKey.length - 1];
                if (lastKey in this.aliases) {
                    this.setValue(lastKey, this.parseValue(value));
                } else {
                    this.args[lastKey] = this.parseValue(value);
                }
            } else {
                // Single flag with value: -k=value
                this.setValue(optionKey, this.parseValue(value));
            }
            return { consumed: 1 };
        } else {
            // -k (boolean flag)
            this.setValue(key, true);
            return { consumed: 1 };
        }
    }

    /**
     * Parse value (handle quotes)
     */
    private parseValue(value: string): string {
        // Remove surrounding quotes if present
        if (
            (value.startsWith("\"") && value.endsWith("\"")) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            return value.slice(1, -1);
        }
        return value;
    }

    /**
     * Set a value with proper categorization
     */
    private setValue(key: string, value: string | boolean): void {
        // Resolve alias if it's a short form
        const resolvedKey = this.aliases[key] || key;

        if (typeof value === "boolean") {
            this.flags[resolvedKey] = value;
        } else {
            this.options[resolvedKey] = value;
        }

        // Always set the value in lowercase (for case-insensitive lookup, like legacy)
        this.args[resolvedKey.toLowerCase()] = value;
    }

    /**
     * Check for conflicts (short + long form of same option)
     */
    private checkConflicts(): void {
        const conflicts: string[] = [];

        for (const [shortKey, longKey] of Object.entries(this.aliases)) {
            const hasShort = this.args[shortKey] !== undefined;
            const hasLong = this.args[longKey] !== undefined;

            if (hasShort && hasLong) {
                conflicts.push(`Both -${shortKey} and --${longKey} specified`);
            }
        }

        if (conflicts.length > 0) {
            throw new Error(`Argument conflicts: ${conflicts.join(", ")}`);
        }
    }

    /**
     * Get a value with precedence order
     */
    get(key: string): any {
        const resolvedKey = this.aliases[key] || key;
        // Normalize key to lowercase for case-insensitive lookups
        // This ensures that params.get("showAuthRequest") works regardless of how
        // the key was provided (CLI: --showAuthRequest, --showauthrequest, env: SHOW_AUTH_REQUEST)
        const lcKey = resolvedKey.toLowerCase();
        this.usedKeys.add(lcKey);

        // Precedence order: overrides > CLI args > config files > env vars > defaults
        // All lookups are case-insensitive using lcKey
        
        // Case-insensitive lookup for overrides
        const overrideKey = Object.keys(this.overrides).find(k => k.toLowerCase() === lcKey);
        if (overrideKey !== undefined) {
            return this.overrides[overrideKey];
        }

        // Case-insensitive lookup for CLI args
        // Try environment-specific CLI args first (e.g., --silent_local, --debug_production)
        const lcKeyWithEnv = `${lcKey}${this.env ? `_${this.env.toLowerCase()}` : ""}`;
        if (this.env && this.args[lcKeyWithEnv] !== undefined) {
            return this.args[lcKeyWithEnv];
        } else if (this.args[lcKey] !== undefined) {
            return this.args[lcKey];
        }

        // Case-insensitive lookup for config file values
        const configKey = Object.keys(this.configValues).find(k => k.toLowerCase() === lcKey);
        if (configKey !== undefined) {
            return this.configValues[configKey];
        }

        // Environment variable (convert key to ENV_VAR format)
        // Use resolvedKey (original case) for env var conversion to preserve camelCase -> SNAKE_CASE
        const envKey = this.toEnvKey(resolvedKey);
        const envKeyWithEnv = `${envKey}${this.env ? `_${this.env.toUpperCase()}` : ""}`;

        // Try environment-specific env vars first (e.g., SILENT_LOCAL, DEBUG_PRODUCTION)
        const envSpecificKey = Object.keys(process.env).find(
            (k) => this.env && k.toUpperCase() === envKeyWithEnv
        );
        
        // Try exact match first (case-insensitive)
        const envKeyFound = Object.keys(process.env).find((k) => k.toUpperCase() === envKey);
        
        // If not found, try alternative formats (e.g., TRESTLE_IDXPLUS_2_ID -> TRESTLE_IDXPLUS2_ID)
        // This handles cases where env var names don't follow standard camelCase->SNAKE_CASE conversion
        const envKeyAlt = envKey.replace(/_([0-9])/g, "$1"); // Remove underscore before numbers
        const envKeyAltFound = !envKeyFound ? Object.keys(process.env).find((k) => k.toUpperCase() === envKeyAlt) : null;

        if (envSpecificKey) {
            return process.env[envSpecificKey];
        } else if (envKeyFound) {
            return process.env[envKeyFound];
        } else if (envKeyAltFound) {
            return process.env[envKeyAltFound];
        }

        // Case-insensitive lookup for defaults
        const defaultKey = Object.keys(this.defaults).find(k => k.toLowerCase() === lcKey);
        if (defaultKey !== undefined) {
            return this.defaults[defaultKey];
        }

        // NODE_ENV fallback for 'env' key (like legacy)
        if (lcKey === "env" && process.env.NODE_ENV !== undefined) {
            return process.env.NODE_ENV;
        }

        return undefined;
    }

    /**
     * Set a value (for testing/internal use)
     */
    set(key: string, value: any): void {
        this.args[key] = value;
    }

    /**
     * Check if a command exists (case-insensitive)
     */
    hasCommand(cmd: string): boolean {
        return this.commands.some((command) => command.toLowerCase() === cmd.toLowerCase());
    }

    /**
     * Get all commands
     */
    getCommands(): string[] {
        return [...this.commands];
    }

    /**
     * Get used keys (as array)
     */
    getUsed(): string[] {
        return Array.from(this.usedKeys);
    }

    /**
     * Get unused keys (as array)
     */
    getUnused(): string[] {
        const unused: string[] = [];

        for (const key of Object.keys(this.args)) {
            if (!this.usedKeys.has(key) && !this.nots.includes(key)) {
                unused.push(key);
            }
        }

        return unused;
    }

    /**
     * Convert key to environment variable format
     * Converts camelCase to SNAKE_CASE
     */
    private toEnvKey(key: string): string {
        // If already in SNAKE_CASE (contains underscores and is uppercase), return as-is
        if (key.includes("_") && key === key.toUpperCase()) {
            return key;
        }

        // Convert camelCase to SNAKE_CASE
        // Standard conversion: add underscore before capitals and numbers
        return key
            .replace(/[A-Z0-9]/g, (match, offset) =>
                offset === 0 ? match : "_" + match.toLowerCase()
            )
            .toUpperCase();
    }

    /**
     * Load .env file
     */
    private loadDotEnv(): void {
        const dotEnvPath = this.get("dotEnvPath") || process.cwd();
        const dotEnvFile = this.get("dotEnvFile") || ".env";

        // If custom dotEnvFile is specified, use it as-is
        if (this.get("dotEnvFile")) {
            const customPath = resolve(dotEnvPath, dotEnvFile);
            if (existsSync(customPath)) {
                config({ path: customPath, quiet: true });
            }
            return;
        }

        // Try environment-specific .env file first (e.g., .env.local, .env.production)
        let dotEnvPathFile: string | null = null;

        const envSpecificFile = `.env.${this.env}`;
        const envSpecificPath = resolve(dotEnvPath, envSpecificFile);
        if (existsSync(envSpecificPath)) {
            dotEnvPathFile = envSpecificPath;
        }

        // If no environment-specific file found in current directory, try examples folder
        if (!dotEnvPathFile && !this.get("dotEnvPath")) {
            const examplesPath = resolve(dotEnvPath, "examples");
            const examplesEnvSpecificPath = resolve(examplesPath, envSpecificFile);
            if (existsSync(examplesEnvSpecificPath)) {
                dotEnvPathFile = examplesEnvSpecificPath;
            }
        }

        // If no environment-specific file found, try default .env
        if (!dotEnvPathFile) {
            dotEnvPathFile = resolve(dotEnvPath, dotEnvFile);

            // If .env file doesn't exist in current directory, try examples folder (for our examples)
            if (!existsSync(dotEnvPathFile)) {
                if (!this.get("dotEnvPath")) {
                    // Try examples folder first (for our examples)
                    const examplesPath = resolve(dotEnvPath, "examples");
                    const examplesEnvFile = resolve(examplesPath, dotEnvFile);
                    if (existsSync(examplesEnvFile)) {
                        dotEnvPathFile = examplesEnvFile;
                    } else {
                        // Try parent directory (like legacy)
                        dotEnvPathFile = resolve(dotEnvPath, "..", dotEnvFile);
                    }
                }
            }
        }

        // Load .env file if it exists
        if (dotEnvPathFile && existsSync(dotEnvPathFile)) {
            config({ path: dotEnvPathFile, quiet: true });
        }
    }

    /**
     * Load configuration files
     */
    private loadConfigFiles(): void {
        this.configsLoaded = [];
        this.configValues = {};

        const _defaultConfigExtension = this.get("defaultConfigExtension") || "js";
        const optConfigFiles = this.get("config") || this.get("configs") || "";
        const configFiles = optConfigFiles ? optConfigFiles.split(/,\s*/) : [];
        const optConfigFilePath = this.get("configPath");

        if (configFiles.length > 0) {
            for (const cfgFile of configFiles) {
                let notLoaded = false;
                let notLoadedEnvSpecific = false;

                const cfgFileWithPath = this.resolveFileWithPath(optConfigFilePath, cfgFile);
                try {
                    const cfgContents = this.requireConfigFile(cfgFileWithPath);
                    this.configValues = { ...this.configValues, ...cfgContents };
                    this.configsLoaded.push(cfgFileWithPath);
                } catch {
                    notLoaded = true;
                }

                const cfgEnvFileWithPath = this.resolveFileWithPath(
                    optConfigFilePath,
                    cfgFile,
                    this.env
                );
                if (cfgEnvFileWithPath !== cfgFileWithPath) {
                    try {
                        const cfgContents = this.requireConfigFile(cfgEnvFileWithPath);
                        this.configValues = { ...this.configValues, ...cfgContents };
                        this.configsLoaded.push(cfgEnvFileWithPath);
                    } catch {
                        notLoadedEnvSpecific = true;
                    }
                } else {
                    notLoadedEnvSpecific = true;
                }

                if (notLoaded && notLoadedEnvSpecific) {
                    throw new Error(`can't load config file "${cfgFileWithPath}"`);
                }
            }
        }
    }

    /**
     * Resolve file path with environment-specific naming
     */
    private resolveFileWithPath(
        optConfigFilePath: string | undefined,
        cfgFile: string,
        env?: string
    ): string {
        let cfgFileWithPath = optConfigFilePath
            ? isAbsolute(optConfigFilePath)
                ? resolve(optConfigFilePath, cfgFile)
                : resolve(process.cwd(), optConfigFilePath, cfgFile)
            : isAbsolute(cfgFile)
                ? cfgFile
                : resolve(process.cwd(), cfgFile);

        const { basePathWithName, extension } = this.splitPath(cfgFileWithPath);
        if (env) {
            cfgFileWithPath = `${basePathWithName}.${env}.${extension || "js"}`;
        } else {
            cfgFileWithPath = `${basePathWithName}.${extension || "js"}`;
        }
        return cfgFileWithPath;
    }

    /**
     * Split file path into base path and extension
     */
    private splitPath(filePath: string): { basePathWithName: string; extension: string } {
        const basePathWithName = join(dirname(filePath), basename(filePath, extname(filePath)));
        const extension = extname(filePath).slice(1);
        return { basePathWithName, extension };
    }

    /**
     * Require a configuration file (supports .js and .json)
     */
    private requireConfigFile(filePath: string): any {
        if (!existsSync(filePath)) {
            throw new Error(`Config file not found: ${filePath}`);
        }

        const ext = extname(filePath).toLowerCase();
        if (ext === ".json") {
            const content = readFileSync(filePath, "utf8");
            return JSON.parse(content);
        } else if (ext === ".js") {
            // For .js files, use require() which is safer than eval
            try {
                // Clear require cache to ensure fresh load
                delete require.cache[require.resolve(filePath)];
                return require(filePath);
            } catch (error) {
                throw new Error(`Failed to load JS config file: ${error instanceof Error ? error.message : String(error)}`);
            }
        } else {
            throw new Error(`Unsupported file extension: ${ext}`);
        }
    }

    /**
     * Get all parsed data
     */
    getParsed(): ParsedArgs {
        return {
            command: this.commands[0] || "",
            flags: { ...this.flags },
            options: { ...this.options },
            usedKeys: Array.from(this.usedKeys)
        };
    }

    /**
     * Set prefixes dynamically and re-parse arguments (like legacy)
     */
    setPrefixes(prefixes: string | string[]): void {
        const arr = Array.isArray(prefixes) ? prefixes : prefixes.split(/,\s*/);
        const sortedArr = arr.sort((a, b) =>
            a.length < b.length ? 1 : a.length > b.length ? -1 : 0
        );
        this.prefixes = sortedArr.map((el) => el.toLowerCase());
        // Re-parse arguments with new prefixes
        const args = process.argv.slice(2);
        this.parseArgs(args);
    }
}

// Singleton pattern (like legacy)
let instance: Args | null = null;

/**
 * Initialize Args instance (singleton pattern)
 */
export function init(args?: string[]): Args {
    instance = new Args({ args });
    return instance;
}

/**
 * Get the current Args instance (singleton pattern)
 */
export function getArgsInstance(): Args | null {
    return instance;
}


