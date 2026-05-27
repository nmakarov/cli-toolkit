import Joi from "joi";
import { ParamError } from "../errors.js";
import { joiEdateType, joiStringArrayType } from "./custom-types.js";

/**
 * Parameter definition types
 */
 







































/**
 * Params class for parameter validation and type checking
 * Built on top of Args library with Joi validation
 */
export class Params {
    context; // Partial context during initialization
    params = {};
    paramSources = {};
    definitions = {};
    args;
    paramSetters = [];
    paramGetters = [];
    trackedParams = [];
    _currentModule = "script";
    /** Resolved early in constructor so cleanup does not read params lazily */
    _showUsedParams = false;

    constructor(context, options = {}) {
        // Context might be partial during initialization
        this.context = context;
        this.args = context.args;

        // Apply initial configuration
        if (Object.keys(options).length > 0) {
            this.configure(options);
        }

        // Resolve showUsedParams early (fail fast, consistent with "params figured in init")
        this._showUsedParams = this.get("showUsedParams", "boolean default false");

        if (context && typeof context.registerCleanup === "function") {
            context.registerCleanup((ctx) => {
                if (!ctx.params.getShowUsedParams()) return;
                const byModule = ctx.params.getFiguredByModule();
                const modules = Object.keys(byModule).sort();
                if (modules.length === 0) return;
                const logger = ctx.logger;
                logger.debug("[Params]: list of used params:");
                
                if (typeof logger.highlight !== "function") {
                    for (const mod of modules) {
                        logger.debug(`  [${mod}]`);
                        for (const [key, entry] of Object.entries(byModule[mod]) ) {
                            logger.debug(`    ${key}: ${JSON.stringify(entry.value)} (${entry.source})`);
                        }
                    }
                    return;
                }
                for (const mod of modules) {
                    logger.debug(`  [${mod}]`);
                    for (const [key, entry] of Object.entries(byModule[mod]) ) {
                        const valueStr = JSON.stringify(entry.value);
                        const display = entry.source === "default" ? valueStr : logger.highlight(valueStr);
                        logger.debug(`    ${key}: ${display} (${entry.source})`);
                    }
                }
            });
        }
    }

    /** Whether --showUsedParams was requested (resolved in constructor). */
    getShowUsedParams() {
        return this._showUsedParams;
    }

    /**
     * Configure parameters
     * Only parameters present in options are updated
     */
    configure(options) {
        for (const [k, v] of Object.entries(options)) {
            // TODO: opt values might be an object with definitions in it, so perhaps `this.set` should be used
            this.params[k] = v;
        }
    }

    /**
     * Initialize Params from context and CLI parameters
     * Note: Params is special - it's initialized early with partial context
     */
    static init(context, options) {
        return new Params(context, options || {});
    }

    /**
     * Track a parameter request for --stopAfter=init and --showUsedParams
     */
    trackParam(key, definition, value, source, moduleName) {
        this.trackedParams.push({
            key,
            definition,
            value,
            source,
            module: moduleName ?? this._currentModule,
        });
    }

    /**
     * Get all tracked parameters (for --stopAfter=init)
     */
    getTrackedParams() {
        return [...this.trackedParams];
    }

    /**
     * Get all figured parameters as a record (flat, last occurrence per key)
     * Returns all parameters that were collected during initialization,
     * whether from CLI args, options, or defaults
     */
    getAllFigured() {
        const result = {};
        for (const param of this.trackedParams) {
            result[param.key] = {
                value: param.value,
                source: param.source,
            };
        }
        return result;
    }

    /**
     * Get figured parameters grouped by module name.
     * Same param can appear in multiple modules (e.g. source, resource).
     */
    getFiguredByModule() {
        const byModule = {};
        for (const param of this.trackedParams) {
            const mod = param.module;
            if (!byModule[mod]) byModule[mod] = {};
            byModule[mod][param.key] = { value: param.value, source: param.source };
        }
        return byModule;
    }

    /**
     * Clear tracked parameters
     */
    clearTrackedParams() {
        this.trackedParams = [];
    }

    /**
     * Assign a parameter definition
     */
    assignDefinition(key, definition) {
        if (this.definitions[key] && !definition) {
            return this.definitions[key];
        }

        let type;
        if (!definition) {
            type = Joi.string();
        } else if (Joi.isSchema(definition)) {
            type = definition;
        } else if (Joi.isSchema(definition.type)) {
            type = definition.type;
        } else if (typeof definition === "string") {
            type = this.toJoi(definition);
        } else if (typeof definition.type === "string") {
            type = this.toJoi(definition.type);
        } else if (!definition.type) {
            type = Joi.string();
        } else {
            type = Joi.string();
        }

        if (!this.definitions[key]) {
            this.definitions[key] = {};
        }
        this.definitions[key].type = type;

        if (definition && definition.values) {
            if (Array.isArray(definition.values)) {
                this.definitions[key].values = definition.values;
            }
        }
        return this.definitions[key];
    }

    /**
     * Convert string definition to Joi schema
     */
    toJoi(str) {
        let type;
        
        if (str.match(/^string|^text/i)) {
            type = Joi.string();
        } else if (str.match(/^number|^integer|^int/i)) {
            type = Joi.number();
        } else if (str.match(/^boolean|^bool/i)) {
            type = Joi.boolean();
        } else if (str.match(/^date/i)) {
            type = Joi.custom(joiEdateType);
        } else if (str.match(/^duration/i)) {
            type = Joi.string().isoDuration();
        } else if (str.match(/^array/i)) {
            let elementTypes = "string";
            const tmp = str.match(/\((.*)\)/);
            if (tmp && tmp[1].match(/string/i)) {
                elementTypes = "string";
            } else if (tmp && tmp[1].match(/number|integer|int/i)) {
                elementTypes = "number";
            } else if (tmp && tmp[1].match(/boolean|bool/i)) {
                elementTypes = "boolean";
            }
            type = Joi.custom(joiStringArrayType(elementTypes));
        } else {
            type = Joi.string();
        }

        // Handle default values
        const regexForDefault = /\bdefault\s+([^\s]+)/;
        const matchForDefault = str.match(regexForDefault);
        if (matchForDefault) {
            const defValObj = type.validate(matchForDefault[1]);
            if (defValObj.error) {
                throw new ParamError(`default value "${defValObj.value}" type mismatch`);
            }
            // Joi's default() automatically allows undefined and applies the default
            type = type.default(defValObj.value);
        } else if (str.match(/\s*required\s*/)) {
            type = type.required();
        } else {
            // If not required and no default, make it optional
            type = type.optional();
        }

        return type;
    }

    /**
     * Validate a value against a definition
     */
    validate(key, val, def) {
        // Convert null to undefined so Joi defaults can be applied
        // Joi's .default() only works with undefined, not null
        const normalizedVal = val === null ? undefined : val;
        
        // Pass current params as context to support cross-parameter references (e.g., @startTime+2h)
        // Use abortEarly: false to get all errors, and allowUnknown: false for strict validation
        const { value, error } = def.type.validate(normalizedVal, { 
            context: { params: this.params },
            abortEarly: false,
            allowUnknown: false,
        });
        if (error) {
            const errs = error.details.map((el) => el.message).join(", ");
            throw new ParamError(`"${key}" validation error: ${errs}`);
        }
        return value;
    }

    /**
     * Get a parameter value with validation
     */
    get(key, definition) {
        const def = this.assignDefinition(key, definition);
        let valFromGetters = undefined;
        
        // eslint-disable-next-line no-constant-condition
        if (def.volatile || true) {
            valFromGetters = this.runAllRegisteredGetters(key);
        }
        
        // Always call args.get() to mark the key as used, even if it doesn't exist
        const valFromArgs = this.args.get(key);
        const valFromParams = this.params[key];

        let source = "default";
        let value;

        if (valFromGetters !== undefined && valFromGetters !== null) {
            value = this.validate(key, valFromGetters, def);
            source = "options";
        } else if (valFromArgs !== undefined && valFromArgs !== null) {
            value = this.validate(key, valFromArgs, def);
            const argsSource = (this.args ).getSource?.(key);
            if (argsSource === "overrides") source = "options";
            else if (argsSource === "cli" || argsSource === "env" || argsSource === "config") source = argsSource;
            else if (argsSource === "default") source = "default";
            else source = "cli";
        } else if (valFromParams !== undefined && valFromParams !== null) {
            value = this.validate(key, valFromParams, def);
            source = this.paramSources[key] ?? "options";
        } else {
            value = this.validate(key, undefined, def);
            source = "default";
        }

        this.paramSources[key] = source;
        // Track parameter for --stopAfter=init and --showUsedParams
        this.trackParam(key, definition || "string", value, source);

        if (value !== undefined && def.values && !def.values.includes(value)) {
            throw new ParamError(`key ${key} should be one of ${def.values}`);
        }
        return value;
    }

    /**
     * Set a parameter value with validation
     */
    set(key, val, definition) {
        // TODO: check if there's a test for this:
        if (val && val.type && val.value) {
            definition = val;
            val = val.value;
        }
        this.assignDefinition(key, definition);

        if (!this.runAllRegisteredSetters(key, val)) {
            this.params[key] = val;
        }
    }

    /**
     * Get all parameters from definitions (main script).
     * Same as getAllForModule("script", defs). Processes left-to-right for cross-parameter references.
     * Libraries should use {@link getAllForModule} with an explicit module name (or {@link runWithModule}
     * around {@link get}) so --showUsedParams groups usage correctly.
     */
    getAll(defs) {
        return this.getAllForModule("script", defs);
    }

    /**
     * Get all parameters from definitions for a given module name.
     * Figured params are grouped by module when using --showUsedParams.
     * Processes parameters left-to-right to support cross-parameter references.
     * If moduleName is omitted, it is inferred from the caller's file path (directory name under src/).
     */
    getAllForModule(moduleNameOrDefs, defs) {
        let moduleName;
        let definitions;
        if (defs !== undefined) {
            moduleName = moduleNameOrDefs ;
            definitions = defs;
        } else {
            definitions = moduleNameOrDefs ;
            moduleName = this._inferModuleNameFromStack();
        }
        const prev = this._currentModule;
        this._currentModule = moduleName;
        try {
            const res = {};
            for (const [k, def] of Object.entries(definitions)) {
                const value = this.get(k, def);
                res[k] = value;
                if (value !== undefined) {
                    this.params[k] = value;
                }
            }
            return res;
        } finally {
            this._currentModule = prev;
        }
    }

    /**
     * Run a callback with {@link _currentModule} set so single {@link get} calls are tracked
     * under the same module (for --showUsedParams / getFiguredByModule).
     */
    runWithModule(moduleName, fn) {
        const prev = this._currentModule;
        this._currentModule = moduleName;
        try {
            return fn();
        } finally {
            this._currentModule = prev;
        }
    }

    /**
     * Async variant of {@link runWithModule} for modules that await params.get().
     */
    async runWithModuleAsync(moduleName, fn) {
        const prev = this._currentModule;
        this._currentModule = moduleName;
        try {
            return await fn();
        } finally {
            this._currentModule = prev;
        }
    }

    /**
     * Infer module name from call stack: first caller outside params/index gives path like .../src/<moduleName>/...
     */
    _inferModuleNameFromStack() {
        const stack = new Error().stack;
        if (!stack) return "script";
        const lines = stack.split("\n");
        const paramsIndexPath = "params" + (typeof process !== "undefined" && process.platform === "win32" ? "\\" : "/") + "index.";
        for (const line of lines) {
            const parenMatch = line.match(/\(([^)]+)\)/);
            if (!parenMatch) continue;
            const parts = parenMatch[1].split(":");
            if (parts.length < 3) continue;
            const path = parts.slice(0, -2).join(":").replace(/^file:\/\//, "");
            if (!path || path.includes(paramsIndexPath)) continue;
            const srcMatch = path.match(/[/\\]src[/\\]([^/\\]+)(?:[/\\]|$)/);
            if (srcMatch) return srcMatch[1];
        }
        return "script";
    }

    /**
     * Run all registered getters for a key
     */
    runAllRegisteredGetters(key) {
        let val = undefined;
        for (const getter of this.paramGetters) {
            val = getter(key, this.definitions[key]);
            if (val !== undefined && val !== null) {
                break;
            }
        }
        return val;
    }

    /**
     * Run all registered setters for a key
     */
    runAllRegisteredSetters(key, value) {
        let setterUsed = false;
        for (const setter of this.paramSetters) {
            setterUsed = setter(key, value);
            if (setterUsed) {
                break;
            }
        }
        return setterUsed;
    }

    /**
     * Register a parameter getter
     */
    registerParamGetter(fn) {
        this.paramGetters.push(fn);
    }

    /**
     * Register a parameter setter
     */
    registerParamSetter(fn) {
        this.paramSetters.push(fn);
    }
}

// Export custom types for external use
export { joiEdateType, joiStringArrayType };

