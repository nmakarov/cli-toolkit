/**
 * Types for Init component
 */

import type { Args } from "../args/index.js";
import type { Params } from "../params/index.js";
import type { Logger } from "../logger/types.js";
import { EventEmitter } from "events";

/**
 * Context object passed to flow function
 * Contains all initialized dependencies and utilities
 */
export interface Context {
    args: Args;
    params: Params;
    logger: Logger;
    emitter: EventEmitter;
    isStop: () => boolean;
    cleanupFunctions: Array<(context: Context) => Promise<void> | void>;
    registerCleanup: (fn: (context: Context) => Promise<void> | void) => void;
}

/**
 * Init options - configuration for initialization
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
     * Logger options
     */
    logger?: {
        mode?: "text" | "json";
        route?: "console" | "ipc";
        prefix?: string;
        silent?: boolean;
        showLevel?: boolean;
        timestamp?: boolean;
        levels?: string[];
    };
    
    /**
     * Modules to initialize (future feature)
     */
    modules?: string[];
}

/**
 * Flow function - the main script function that receives context
 */
export type FlowFunction = (context: Context) => Promise<void> | void;

