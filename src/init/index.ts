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
import type { Context, InitOptions, FlowFunction } from "./types.js";
import { EventEmitter } from "events";

/**
 * Partial context used during initialization
 * Components are added as they're created
 */
interface PartialContext {
    args?: Args;
    params?: Params;
    logger?: any;
    emitter: EventEmitter;
    isStop: () => boolean;
    cleanupFunctions: Array<(context: Context) => Promise<void> | void>;
    registerCleanup: (fn: (context: Context) => Promise<void> | void) => void;
}

/**
 * Extract component-specific options from InitOptions
 * Removes reserved keys (overrides, defaults, modules) and returns component options
 */
function extractComponentOptions(opts: InitOptions, componentName: string): Record<string, any> {
    const reservedKeys = ["overrides", "defaults", "modules"];
    const componentOptions: Record<string, any> = {};
    
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
function setup(opts: InitOptions = {}): Context {
    // Stage 1: Create partial context first (Args will register its cleanup on it)
    const partialContext: PartialContext = {
        emitter: new EventEmitter(),
        isStop: () => false,
        cleanupFunctions: [],
        registerCleanup: (fn: (context: Context) => Promise<void> | void) => {
            partialContext.cleanupFunctions.push(fn);
        },
    };

    // Stage 2: Initialize Args with partial context so it can register unused-args cleanup
    const args = Args.init(partialContext as any, {
        overrides: opts.overrides || {},
        defaults: opts.defaults || {},
    });
    partialContext.args = args;

    // Stage 3: Initialize Params with partial context
    const params = Params.init(partialContext as any, opts.overrides || {});
    partialContext.params = params;

    // Stage 4: Initialize Logger with partial context (now has Args and Params)
    // Extract logger options from top-level opts (mode, route, prefix, etc.)
    const loggerOptions = extractComponentOptions(opts, "logger");
    const logger = Logger.init(partialContext as any, loggerOptions);
    partialContext.logger = logger;

    // Stage 5: Create complete context
    const context: Context = {
        args,
        params,
        logger,
        emitter: partialContext.emitter,
        isStop: partialContext.isStop,
        cleanupFunctions: partialContext.cleanupFunctions,
        registerCleanup: partialContext.registerCleanup,
    };

    logger.debug("[setup] completed successfully");
    return context;
}

/**
 * Setup modules (future feature - placeholder for now)
 */
async function setupModules(context: Context, opts: InitOptions = {}): Promise<Context> {
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
function printAllParameters(context: Context): void {
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
export async function init(flow: FlowFunction, opts: InitOptions = {}): Promise<void> {
    let stop = false;
    let context: Context | null = null;
    let cleanupRan = false;

    const runRegisteredCleanups = async (ctx: Context): Promise<void> => {
        if (cleanupRan) return;
        cleanupRan = true;
        const fns = [...ctx.cleanupFunctions].reverse();
        for (const fn of fns) {
            try {
                await fn(ctx);
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
        
        // Set isStop function
        context.isStop = () => stop;

        // Setup modules (future feature)
        context = await setupModules(context, opts);

        // Resolve params used by init (stopAfter, stopAllowance) early
        const stopAfter = context.args.get("stopAfter");
        const stopAllowance = context.params.get("stopAllowance", "number default 5");

        if (stopAfter === "init") {
            printAllParameters(context);
            process.exit(0);
        }

        // Graceful shutdown: first Ctrl+C sets stop + emits; second runs registered cleanups then exits.
        // (Previously, process.exit(2) on second SIGINT skipped try/finally, so registerCleanup never ran.)
        let sigintCount = 0;
        process.on("SIGINT", async () => {
            if (!context) return;
            sigintCount += 1;
            if (sigintCount === 1) {
                stop = true;
                context.logger.info(`>> emitting stop with allowance ${stopAllowance}`);
                context.emitter.emit("stop", stopAllowance);
                return;
            }
            context.logger.warn("[process] second SIGINT: running cleanup then exit");
            await runRegisteredCleanups(context);
            process.exit(2);
        });

        process.on("SIGTERM", () => {
            if (!context || stop) return;
            stop = true;
            context.logger.info(`>> SIGTERM: emitting stop with allowance ${stopAllowance}`);
            context.emitter.emit("stop", stopAllowance);
        });

        // Execute the flow function
        await flow(context);

    } catch (error) {
        // Error handling with proper error types
        const errorLocation = error instanceof Error && error.stack
            ? error.stack.split("\n")[1]?.trim() || "Unknown location"
            : "Unknown location";

        // Use logger if available, otherwise fall back to console.error
        const logError = (msg: string, ...args: any[]) => {
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
    }
}

/**
 * Setup function - can be used independently to get context without executing flow
 * Useful for testing or advanced use cases
 */
export function setupContext(opts: InitOptions = {}): Context {
    return setup(opts);
}

