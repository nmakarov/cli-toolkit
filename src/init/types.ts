/**
 * Types for Init component
 */

import type { Args } from "../args/index.js";
import type { Params } from "../params/index.js";
import type { Logger } from "../logger/types.js";
import { EventEmitter } from "events";

/**
 * Full **script context**: stable toolkit fields plus any extra properties.
 *
 * **Core** fields (always set by `init`) are listed in the object type below. Anything else
 * (`db`, `tasksQueueName`, your own services, …) may be attached at runtime. Those keys are not
 * declared here; they appear via the intersection with `Record<string, unknown>`, so each is
 * typed as `unknown` unless you narrow or [augment](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)
 * `Context` in your application.
 */
export type Context = {
    args: Args;
    params: Params;
    logger: Logger;
    emitter: EventEmitter;
    isStop: () => boolean;
    cleanupFunctions: Array<(context: Context) => Promise<void> | void>;
    registerCleanup: (fn: (context: Context) => Promise<void> | void) => void;
} & Record<string, unknown>;

/**
 * Only the **core** keys from {@link Context} (no open index signature). Useful for typing
 * “what init always provides” vs optional attachments.
 */
export type ContextCore = Pick<
    Context,
    "args" | "params" | "logger" | "emitter" | "isStop" | "cleanupFunctions" | "registerCleanup"
>;

/**
 * Init options - configuration for initialization
 * Component-specific options are passed at the top level
 * The 'modules' key is reserved for specifying which components to auto-instantiate
 */
export interface InitOptions {
    /**
     * Overrides for Args (highest precedence)
     */
    overrides?: Record<string, any>;

    /**
     * Defaults for Args (lowest precedence)
     */
    defaults?: Record<string, any>;

    /**
     * Modules to initialize - specifies which components should be auto-instantiated
     * Reserved key - do not use for component options
     */
    modules?: string[];

    // Logger component options (when modules includes "logger")
    mode?: "text" | "json";
    route?: "console" | "ipc";
    prefix?: string;
    silent?: boolean;
    showLevel?: boolean;
    timestamp?: boolean;
    levels?: string[];

    // Allow other component options to be passed
    [key: string]: any;
}

/**
 * Flow function - the main script function that receives context
 */
export type FlowFunction = (context: Context) => Promise<void> | void;
