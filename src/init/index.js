/**
 * Init component - Framework initialization and flow execution
 * 
 * Provides a standardized way to initialize CLI scripts with Args, Params, Logger,
 * and other dependencies, then execute the main flow function.
 */

import { Args } from "../args/index.js";
import { Params } from "../params/index.js";
import { Logger } from "../logger/index.js";
import { ParamError, InitError } from "../errors.js";

import { EventEmitter } from "events";

/**
 * Partial context used during initialization
 * Components are added as they're created
 */










/**
 * Extract component-specific options from InitOptions
 * Removes reserved keys (overrides, defaults, modules) and returns component options
 */
function extractComponentOptions(opts, _componentName) {
    const reservedKeys = ["overrides", "defaults", "modules"];
    const componentOptions = {};
    
    for (const [key, value] of Object.entries(opts)) {
        if (!reservedKeys.includes(key)) {
            componentOptions[key] = value;
        }
    }
    
    return componentOptions;
}

/**
 * Setup initial context with Args, Params, and Logger
 * Uses staged initialization to handle circular dependencies
 */
function setup(opts = {}) {
    // Stage 1: Create partial context first (Args will register its cleanup on it)
    const partialContext = {
        emitter: new EventEmitter(),
        isStop: () => false,
        isKill: () => false,
        cleanupFunctions: [],
        registerCleanup: (fn) => {
            partialContext.cleanupFunctions.push(fn);
        },
    };

    // Stage 2: Initialize Args with partial context so it can register unused-args cleanup
    const args = Args.init(partialContext , {
        overrides: opts.overrides || {},
        defaults: opts.defaults || {},
    });
    partialContext.args = args;

    // Stage 3: Initialize Params with partial context
    const params = Params.init(partialContext , opts.overrides || {});
    partialContext.params = params;

    // Stage 4: Initialize Logger with partial context (now has Args and Params)
    // Extract logger options from top-level opts (mode, route, prefix, etc.)
    const loggerOptions = extractComponentOptions(opts, "logger");
    const logger = Logger.init(partialContext , loggerOptions);
    partialContext.logger = logger;

    // Stage 5: Create complete context
    const context = {
        args,
        params,
        logger,
        emitter: partialContext.emitter,
        isStop: partialContext.isStop,
        isKill: partialContext.isKill,
        cleanupFunctions: partialContext.cleanupFunctions,
        registerCleanup: partialContext.registerCleanup,
        // For long-running scripts (servers): with --showUsedParams=top, print
        // the used-params list now (after the script has initialized all its
        // own components), instead of at exit. No-op for the default mode,
        // which prints at exit via the cleanup registered by Params.
        //
        // --showUsedParams=stop behaves like "top" but then exits immediately —
        // a quick "show me the figured params and quit" that skips the flow's
        // actual work. Like --stopAfter=init, this is a hard exit(0) (registered
        // cleanups are skipped); call it once components/params are resolved.
        _requestExitCode: null,
        requestExit: null,
        showUsedParamsIfNeeded: () => {
            const mode = params.getShowUsedParamsMode?.();
            if (mode !== "top" && mode !== "stop") return;
            params.printUsedParams(logger);
            if (mode === "stop") {
                logger.debug?.("[showUsedParams=stop] params printed — exiting");
                process.exit(0);
            }
        },
    };

    // Interactive CLIs (tasksmm) call this before returning so leftover
    // knex/DNS handles cannot keep the process alive after cleanup.
    context.requestExit = (code = 0) => {
        context._requestExitCode = code;
    };

    logger.debug("[setup] completed successfully");
    return context;
}

/**
 * Setup modules (future feature - placeholder for now)
 */
async function setupModules(context, opts = {}) {
    // TODO: Implement module initialization
    // For now, just log that modules would be initialized
    if (opts.modules && opts.modules.length > 0) {
        context.logger.debug(`[setupModules] modules specified: ${opts.modules.join(", ")} (not yet implemented)`);
    }
    context.logger.debug("[setupModules] completed successfully");
    return context;
}

/**
 * Print all figured parameters for --stopAfter=init
 */
function printAllParameters(context) {
    const trackedParams = context.params.getTrackedParams();
    
    console.log("\n=== All Figured Parameters ===");
    console.log("\nComponent: Logger");
    const loggerParams = trackedParams.filter(p => 
        ["mode", "route", "prefix", "silent", "showLevel", "timestamp", "levels"].includes(p.key)
    );
    if (loggerParams.length > 0) {
        loggerParams.forEach(p => {
            console.log(`  ${p.key}: ${JSON.stringify(p.value)} (from ${p.source})`);
        });
    } else {
        console.log("  (no parameters requested)");
    }

    // Add other components as they're initialized
    console.log("\n=== End Parameters ===\n");
}

/**
 * Initialize framework and execute flow function
 * 
 * Automatically handles async module loading (e.g., ESM dependencies for screen module)
 * so users don't need to call load() manually.
 * 
 * @param flow - Main function that receives context and executes the script logic
 * @param opts - Configuration options for initialization
 */
export async function init(flow, opts = {}) {
    let stop = false;
    let kill = false;
    let context = null;
    let cleanupRan = false;

    const runRegisteredCleanups = async (ctx) => {
        if (cleanupRan) return;
        cleanupRan = true;
        const fns = [...ctx.cleanupFunctions].reverse();
        const budgetMs = 5_000;
        const started = Date.now();
        for (const fn of fns) {
            const left = budgetMs - (Date.now() - started);
            if (left <= 0) {
                ctx.logger.warn("[cleanup] budget exhausted — skipping remaining cleanup");
                break;
            }
            try {
                await Promise.race([
                    Promise.resolve(fn(ctx)),
                    new Promise((_, reject) => {
                        const t = setTimeout(
                            () => reject(new Error(`cleanup timed out after ${left}ms`)),
                            left,
                        );
                        t.unref?.();
                    }),
                ]);
            } catch (error) {
                ctx.logger.warn("[cleanup] error in cleanup function:", error);
            }
        }
    };

    try {
        // Pre-load ESM dependencies (ink, react) for CommonJS compatibility
        // This ensures screen-related functionality works in CommonJS environments
        // The load() function is available from the screen module or main package
        try {
            // Try to import screen module and call its load function
            // This works in both ESM and CommonJS (via dynamic import)
            const screenModule = await import("../screen/index.js");
            if (screenModule && typeof screenModule.load === "function") {
                await screenModule.load();
            }
        } catch {
            // If screen module load fails, try accessing via main package (CommonJS)
            if (typeof require !== "undefined") {
                try {
                    // In CommonJS, the main package may have been required and exports load()
                    // We can't use require() here as it would be synchronous, so we skip it
                    // The screen module import above should work in both cases
                } catch {
                    // Ignore - screen functionality may not be needed
                }
            }
        }

        // Setup context with Args, Params, Logger
        context = setup(opts);
        
        // Cooperative stop (SIGINT/SIGTERM) vs urgent kill (SIGUSR2).
        // Kill also sets stop so existing `isStop()` loops exit promptly.
        context.isStop = () => stop;
        context.isKill = () => kill;

        // Setup modules (future feature)
        context = await setupModules(context, opts);

        // Resolve params used by init (stopAfter, stopAllowance) early.
        // `stopAllowance` is seconds (CLI/env); runners and pm2 kill_timeout use ms.
        const stopAfter = context.args.get("stopAfter");
        const stopAllowanceSec = Number(context.params.get("stopAllowance", "number default 60"));
        const stopAllowanceMs = (Number.isFinite(stopAllowanceSec) && stopAllowanceSec >= 0
            ? stopAllowanceSec
            : 60) * 1000;
        context.stopAllowanceSec = stopAllowanceSec;
        context.stopAllowanceMs = stopAllowanceMs;

        if (stopAfter === "init") {
            printAllParameters(context);
            process.exit(0);
        }

        // Graceful shutdown: first Ctrl+C sets stop + emits; second runs registered cleanups then exits.
        // (Previously, process.exit(2) on second SIGINT skipped try/finally, so registerCleanup never ran.)
        let sigintCount = 0;
        let firstSigintAt = 0;
        process.on("SIGINT", async () => {
            if (!context) return;
            const now = Date.now();
            if (sigintCount === 0) {
                sigintCount = 1;
                firstSigintAt = now;
                stop = true;
                context.logger.info(
                    `>> emitting stop with allowance ${stopAllowanceSec}s (${stopAllowanceMs}ms)`
                );
                context.emitter.emit("stop", stopAllowanceMs);
                return;
            }
            // A single Ctrl+C can reach Node as TWO SIGINTs (e.g. under
            // `npm run`: the terminal signals the whole process group AND npm
            // forwards the signal). Those duplicates land within a few ms, so
            // ignore a second SIGINT that arrives shortly after the first —
            // otherwise we'd force-exit (below) before the graceful cleanup
            // chain finishes, skipping late cleanups like --showUsedParams.
            if (now - firstSigintAt < 250) return;
            context.logger.warn("[process] second SIGINT: running cleanup then exit");
            await runRegisteredCleanups(context);
            process.exit(2);
        });

        process.on("SIGTERM", () => {
            if (!context || stop) return;
            stop = true;
            context.logger.info(
                `>> SIGTERM: emitting stop with allowance ${stopAllowanceSec}s (${stopAllowanceMs}ms)`
            );
            context.emitter.emit("stop", stopAllowanceMs);
        });

        // Urgent abort (e.g. `pm2 sendSignal SIGUSR2 <app>`). Parents that spawn
        // children (retro loops) should forward SIGUSR2 on the "kill" event so the
        // child init flips isKill() and breaks its own loops cooperatively.
        process.on("SIGUSR2", () => {
            if (!context || kill) return;
            kill = true;
            stop = true;
            context.logger.warn(">> SIGUSR2: emitting kill (urgent stop)");
            context.emitter.emit("kill");
            context.emitter.emit("stop", stopAllowanceMs);
        });

        // Execute the flow function
        await flow(context);

    } catch (error) {
        // Error handling with proper error types
        const errorLocation = error instanceof Error && error.stack
            ? error.stack.split("\n")[1]?.trim() || "Unknown location"
            : "Unknown location";

        // Use logger if available, otherwise fall back to console.error
        const logError = (msg, ...args) => {
            if (context?.logger) {
                context.logger.error(msg, ...args);
            } else {
                console.error(msg, ...args);
            }
        };

        if (error instanceof ParamError) {
            logError(`[params]: ${error.message} (${errorLocation})`);
            process.exitCode = 3;
        } else if (error instanceof InitError) {
            logError(`[init]: ${error.message} (${errorLocation})`);
            process.exitCode = 4;
        } else {
            logError(`[other] error:`, error, errorLocation);
            process.exitCode = 5;
        }
    } finally {
        if (context) {
            await runRegisteredCleanups(context);
        }
        // Open handles (logger, SDK agents, signal listeners, …) can keep Node
        // alive after the flow returns. Under pm2 that becomes a zombie: the
        // runner has unregistered and disconnected, but pm2 waits kill_timeout
        // then SIGKILL. Force-exit on errors and on cooperative/signal stop.
        if (process.exitCode && process.exitCode !== 0) {
            process.exit(process.exitCode);
        } else if (stop || kill) {
            process.exit(0);
        } else if (context._requestExitCode != null) {
            process.exit(context._requestExitCode);
        }
    }
}

/**
 * Setup function - can be used independently to get context without executing flow
 * Useful for testing or advanced use cases
 */
export function setupContext(opts = {}) {
    return setup(opts);
}

