/**
 * Init component - Framework initialization and flow execution
 * 
 * Provides a standardized way to initialize CLI scripts with Args, Params, Logger,
 * and other dependencies, then execute the main flow function.
 */

import { Args } from "../args/index.js";
import { Params } from "../params/index.js";
import { CliToolkitLogger } from "../logger/index.js";
import { ParamError, InitError } from "../errors.js";
import type { Context, InitOptions, FlowFunction } from "./types.js";
import { EventEmitter } from "events";

/**
 * Setup initial context with Args, Params, and Logger
 */
function setup(opts: InitOptions = {}): Context {
    // Initialize Args with overrides and defaults from opts
    const args = new Args({
        overrides: opts.overrides || {},
        defaults: opts.defaults || {},
    });

    // Initialize Params with Args instance
    const params = new Params({ args }, opts.overrides || {});

    // Initialize Logger with options from opts
    const loggerOptions = opts.logger || {};
    const logger = new CliToolkitLogger({
        mode: loggerOptions.mode || "text",
        route: loggerOptions.route || "console",
        prefix: loggerOptions.prefix,
        silent: loggerOptions.silent,
        showLevel: loggerOptions.showLevel,
        timestamp: loggerOptions.timestamp,
        levels: loggerOptions.levels,
    });

    // Create cleanup functions array
    const cleanupFunctions: Array<(context: Context) => Promise<void> | void> = [];

    // Create context
    const context: Context = {
        args,
        params,
        logger,
        emitter: new EventEmitter(),
        isStop: () => false, // Will be set in init function
        cleanupFunctions,
        registerCleanup: (fn: (context: Context) => Promise<void> | void) => {
            cleanupFunctions.push(fn);
        },
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

        // Setup SIGINT handler for graceful shutdown
        process.on("SIGINT", async () => {
            if (stop) {
                context!.logger.warn("[process] killed");
                process.exit(2);
            }
            stop = true;
            
            // Get stop allowance from params
            let allowance = 5; // default
            try {
                allowance = context!.params.get("stopAllowance", "number default 5");
            } catch {
                // Use default if not provided
            }
            
            context!.logger.info(`>> emitting stop with allowance ${allowance}`);
            context!.emitter.emit("stop", allowance);
        });

        // Execute the flow function
        await flow(context);

    } catch (error) {
        // Error handling with proper error types
        const errorLocation = error instanceof Error && error.stack
            ? error.stack.split("\n")[1]?.trim() || "Unknown location"
            : "Unknown location";

        if (error instanceof ParamError) {
            context?.logger.error(`[params]: ${error.message} (${errorLocation})`);
            process.exitCode = 3;
        } else if (error instanceof InitError) {
            context?.logger.error(`[init]: ${error.message} (${errorLocation})`);
            process.exitCode = 4;
        } else {
            context?.logger.error(`[other] error:`, error, errorLocation);
            process.exitCode = 5;
        }
    } finally {
        // Run cleanup functions in reverse order
        if (context) {
            for (const fn of context.cleanupFunctions.reverse()) {
                try {
                    await fn(context);
                } catch (error) {
                    context.logger.warn("[cleanup] error in cleanup function:", error);
                }
            }

            // Warn about unused CLI args
            const unusedArgs = context.args.getUnused();
            if (unusedArgs.length > 0) {
                context.logger.warn("Unused CLI args:", unusedArgs.join(", "));
            }
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

