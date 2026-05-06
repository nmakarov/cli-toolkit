import chalk from "chalk";
import util from "util";










import { ConsoleTransport, ParentProcessTransport } from "./transports.js";


const ALL_LEVELS = [
    "silly",
    "debug",
    "logic",
    "info",
    "notice",
    "warn",
    "error",
    "results",
    "request",
    "response",
    "progress"
];
const DEFAULT_LEVELS = ALL_LEVELS.filter((l) => l !== "silly");

// Calculate maximum level name length for alignment
const MAX_LEVEL_LENGTH = Math.max(...ALL_LEVELS.map(level => level.toUpperCase().length));

const LEVEL_COLORS = {
    error: chalk.red.bold,
    warn: chalk.rgb(255, 165, 0),
    notice: chalk.cyan,
    info: chalk.white.bold,
    logic: chalk.gray,
    debug: chalk.gray,
    silly: chalk.gray,
    request: chalk.green,
    response: chalk.yellow,
    progress: chalk.green,
    results: chalk.magenta
};













export class Logger  {
    context; // Partial context during initialization
    options;
    transport;
    startTimes = {};
    lastProgressTimes = {};

    constructor(context, options = {}) {
        this.context = context;
        // Set defaults first
        this.options = this.getDefaultOptions();
        // Apply configuration
        if (options) {
            this.configure(options);
        }
        // Initialize transport
        this.updateTransport();
    }

    /**
     * Configure logger options. Accepts both LoggerOptions shape and flat param names (levels string, progressWithTimes, progressThrottleMs).
     */
    configure(options) {
        if (options.mode !== undefined) {
            this.options.mode = this.isValidMode(options.mode) ? options.mode : "text";
        }
        if (options.route !== undefined) {
            this.options.route = options.route;
            this.updateTransport();
        }
        if (options.prefix !== undefined) this.options.prefix = options.prefix;
        if (options.silent !== undefined) this.options.silent = options.silent;
        if (options.showLevel !== undefined) this.options.showLevel = options.showLevel;
        if (options.timestamp !== undefined) this.options.timestamp = options.timestamp;
        if (options.levels !== undefined) {
            const levels = typeof options.levels === "string" ? options.levels.split(",") : options.levels;
            this.options.levels = this.normalizeLevels(levels);
        }
        if (options.progress !== undefined) {
            if (options.progress.withTimes !== undefined) this.options.progressTimes = options.progress.withTimes;
            if (options.progress.throttleMs !== undefined) this.options.progressThrottle = options.progress.throttleMs;
        }
        const flat = options ;
        if (flat.progressWithTimes !== undefined) this.options.progressTimes = flat.progressWithTimes;
        if (flat.progressThrottleMs !== undefined) this.options.progressThrottle = flat.progressThrottleMs;
    }

    /**
     * Initialize logger from context and CLI parameters. Whatever is in options goes (after discovered params).
     * Params are tracked under the `logger` module for --showUsedParams.
     */
    static init(context, options) {
        const paramDefs = {
            mode: "string default text",
            route: "string default console",
            prefix: "string",
            silent: "boolean default false",
            showLevel: "boolean default true",
            timestamp: "boolean default false",
            levels: "string",
            progressWithTimes: "boolean default false",
            progressThrottleMs: "number",
        };
        const discovered = context.params.getAllForModule("logger", paramDefs);
        const config = { ...discovered, ...options } ;
        const logger = new Logger(context, config);
        context.logger = logger;
        return logger;
    }

    getDefaultOptions() {
        return {
            mode: "text",
            route: this.shouldUseIpcRoute() ? "ipc" : "console",
            prefix: undefined,
            silent: false,
            showLevel: false,
            timestamp: false,
            levels: DEFAULT_LEVELS,
            progressTimes: false,
            progressThrottle: undefined,
        };
    }

    updateTransport() {
        this.transport = this.options.route === "ipc"
            ? new ParentProcessTransport()
            : new ConsoleTransport();
    }

    setMode(mode) {
        if (!this.isValidMode(mode)) {
            throw new Error(`Unsupported logger mode: ${mode}`);
        }
        this.options.mode = mode;
    }

    /** Returns a styled string (bright white) for highlighting; keeps chalk inside logger. */
    highlight(text) {
        return chalk.whiteBright(text);
    }

    debug(message, ...chunks) {
        this.out({ level: "debug", message, chunks });
    }

    info(message, ...chunks) {
        this.out({ level: "info", message, chunks });
    }

    notice(message, ...chunks) {
        this.out({ level: "notice", message, chunks });
    }

    warn(message, ...chunks) {
        this.out({ level: "warn", message, chunks });
    }

    error(message, ...chunks) {
        this.out({ level: "error", message, chunks });
    }

    logic(message, ...chunks) {
        this.out({ level: "logic", message, chunks });
    }

    silly(message, ...chunks) {
        this.out({ level: "silly", message, chunks });
    }

    results(results) {
        this.out({ level: "results", message: "results", results });
    }

    request(operation, ...chunks) {
        const message = this.inspectChunks([operation, ...chunks]);
        this.out({ level: "request", message });
    }

    response(operation, ...chunks) {
        const message = this.inspectChunks([operation, ...chunks]);
        this.out({ level: "response", message });
    }

    progress(message, opts) {
        const { prefix, count, total } = opts;
        const paddedTotal = String(total).length;
        const paddedCount = String(count).padStart(paddedTotal, " ");
        const payload = {
            level: "progress",
            message,
            count: paddedCount,
            total,
            prefix
        };

        if (!this.startTimes[prefix ?? ""]) {
            this.startTimes[prefix ?? ""] = Date.now();
        }
        if (this.options.progressTimes) {
            const elapsedSeconds = (Date.now() - this.startTimes[prefix ?? ""]) / 1000;
            let remaining = -1;
            if (count > 1) {
                const rate = elapsedSeconds / (count - 1);
                remaining = (total - count) * rate;
            }
            payload.elapsed = this.round(elapsedSeconds, 2);
            payload.remaining = remaining >= 0 ? this.round(remaining, 2) : remaining;
        }

        if (count >= total) {
            delete this.startTimes[prefix ?? ""];
            delete this.lastProgressTimes[prefix ?? ""];
        }

        if (this.shouldOutputProgress(prefix ?? "", count, total)) {
            this.out(payload);
            if (this.options.progressThrottle && prefix) {
                this.lastProgressTimes[prefix] = Date.now();
            }
        }
    }

    shouldOutputProgress(prefix, count, total) {
        if (!this.options.progressThrottle) {
            return true;
        }
        if (count === 1 || count === total || !prefix) {
            return true;
        }
        const lastTime = this.lastProgressTimes[prefix];
        if (!lastTime) {
            return true;
        }
        return Date.now() - lastTime >= this.options.progressThrottle;
    }

    out(struct) {
        if (this.options.silent) {
            return;
        }
        if (!this.options.levels.includes(struct.level)) {
            return;
        }

        if (this.options.prefix && !struct.prefix) {
            struct.prefix = this.options.prefix;
        }

        const output = this.options.mode === "json"
            ? struct
            : this.formatLog(struct);

        this.transport.write(output);
    }

    formatLog(struct) {
        const parts = [];
        const now = new Date();

        if (this.options.timestamp) {
            parts.push(now.toISOString());
        }

        if (this.options.showLevel) {
            parts.push(struct.level.toUpperCase().padEnd(MAX_LEVEL_LENGTH));
        }

        if (struct.level === "progress") {
            if (struct.prefix) {
                parts.push(LEVEL_COLORS[struct.level].bold(struct.prefix));
            }
            if (struct.count !== undefined && struct.total !== undefined) {
                parts.push(LEVEL_COLORS[struct.level](`${struct.count}/${struct.total}`));
            }
        } else if (struct.prefix) {
            parts.push(chalk.cyan(`[${struct.prefix}]`));
        }

        if (struct.message) {
            const formatter = LEVEL_COLORS[struct.level] ?? chalk.white;
            parts.push(formatter.bold(struct.message));
        }

        if (struct.level === "progress") {
            if (struct.elapsed !== undefined && struct.remaining !== undefined) {
                const formatter = LEVEL_COLORS[struct.level];
                parts.push(formatter(`${struct.elapsed}/${struct.remaining}`));
            }
        }

        if (struct.chunks && struct.chunks.length) {
            parts.push(this.inspectChunks(struct.chunks));
        }

        if (struct.results) {
            const formatter = LEVEL_COLORS[struct.level] ?? chalk.white;
            parts.push(formatter(JSON.stringify(struct.results, null, 4)));
        }

        return parts.join(" ");
    }

    inspectChunks(chunks) {
        return chunks
            .map(chunk => util.inspect(chunk, { colors: true, depth: null }))
            .join(" ");
    }

    shouldUseIpcRoute() {
        // Don't use IPC in test environments (Vitest workers interfere with process.send)
        if (process.env.VITEST || process.env.NODE_ENV === "test") {
            return false;
        }
        // Only use IPC if process.send exists AND we're connected to a parent
        // In Vitest workers, process.send exists but process.connected is undefined/false
        // process.connected is only true in actual child processes created with fork()
        return typeof process.send === "function" && process.connected === true;
    }

    normalizeLevels(levels) {
        if (!levels || !levels.length) {
            return DEFAULT_LEVELS;
        }

        const tokens = levels.map((t) => String(t).trim()).filter(Boolean);
        const explicitIncludes = tokens
            .filter((t) => !t.startsWith("+") && !t.startsWith("-"))
            .map((t) => t );
        const addIncludes = tokens
            .filter((t) => t.startsWith("+"))
            .map((t) => t.slice(1) );
        const excludes = tokens
            .filter((t) => t.startsWith("-"))
            .map((t) => t.slice(1) );

        const unknown = [...explicitIncludes, ...addIncludes, ...excludes].filter(level => !ALL_LEVELS.includes(level));
        if (unknown.length) {
            console.warn(`[Logger] Unknown level(s): ${unknown.join(", ")}`);
        }

        const base = explicitIncludes.length
            ? explicitIncludes
            : Array.from(new Set([...DEFAULT_LEVELS, ...addIncludes]));
        return base.filter(level => !excludes.includes(level));
    }

    isValidMode(mode) {
        return mode === undefined || mode === null || mode === "text" || mode === "json";
    }

    round(value, places) {
        const factor = Math.pow(10, places);
        return Math.round(value * factor) / factor;
    }
}

