import Joi from "joi";
import { ParamError } from "../errors";
import { joiEdateType, joiStringArrayType } from "./custom-types";

/**
 * Parameter definition types
 */
export type ParamDefinition = 
    | string 
    | Joi.Schema 
    | { 
        type?: string | Joi.Schema; 
        values?: any[]; 
        [key: string]: any; 
      };

export type ParamGetter = (key: string, definition?: any) => any;
export type ParamSetter = (key: string, value: any) => boolean;

/**
 * Args instance interface
 */
export interface ArgsInstance {
    get(key: string): any;
}

/**
 * Params constructor options
 */
export interface ParamsOptions {
    [key: string]: any;
}

/**
 * Params class for parameter validation and type checking
 * Built on top of Args library with Joi validation
 */
export class Params {
    private params: Record<string, any> = {};
    private definitions: Record<string, any> = {};
    private args: ArgsInstance;
    private paramSetters: ParamSetter[] = [];
    private paramGetters: ParamGetter[] = [];

    constructor({ args }: { args: ArgsInstance }, opts: ParamsOptions = {}) {
        this.args = args;

        for (const [k, v] of Object.entries(opts)) {
            // TODO: opt values might be an object with definitions in it, so perhaps `this.set` should be used
            this.params[k] = v;
        }
    }

    /**
     * Assign a parameter definition
     */
    assignDefinition(key: string, definition?: ParamDefinition): any {
        if (this.definitions[key] && !definition) {
            return this.definitions[key];
        }

        let type: Joi.Schema;
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
    toJoi(str: string): Joi.Schema {
        let type: Joi.Schema;
        
        if (str.match(/^string|^text/i)) {
            type = Joi.string();
        } else if (str.match(/^number|^integer|^int/i)) {
            type = Joi.number();
        } else if (str.match(/^boolean|^bool/i)) {
            type = Joi.boolean();
        } else if (str.match(/^date/i)) {
            type = Joi.date();
        } else if (str.match(/^edate/i)) {
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
            type = type.default(defValObj.value);
        } else if (str.match(/required/)) {
            type = type.required();
        }

        return type;
    }

    /**
     * Validate a value against a definition
     */
    validate(key: string, val: any, def: any): any {
        // Pass current params as context to support cross-parameter references (e.g., @startTime+2h)
        const { value, error } = def.type.validate(val, { context: { params: this.params } });
        if (error) {
            const errs = error.details.map((el: any) => el.message).join(", ");
            throw new ParamError(`"${key}" validation error: ${errs}`);
        }
        return value;
    }

    /**
     * Get a parameter value with validation
     */
    get(key: string, definition?: ParamDefinition): any {
        const def = this.assignDefinition(key, definition);
        let valFromGetters: any = undefined;
        
        if (def.volatile || true) {
            valFromGetters = this.runAllRegisteredGetters(key);
        }
        
        const valFromArgs = this.args.get(key);
        const valFromParams = this.params[key];

        const res = valFromGetters ? this.validate(key, valFromGetters, def) :
            valFromArgs ? this.validate(key, valFromArgs, def) :
                this.validate(key, valFromParams, def);

        if (res !== undefined && def.values && !def.values.includes(res)) {
            throw new ParamError(`key ${key} should be one of ${def.values}`);
        }
        return res;
    }

    /**
     * Set a parameter value with validation
     */
    set(key: string, val: any, definition?: ParamDefinition): void {
        // TODO: check if there's a test for this:
        if (val && val.type && val.value) {
            definition = val;
            val = val.value;
        }
        const def = this.assignDefinition(key, definition);

        if (!this.runAllRegisteredSetters(key, val)) {
            this.params[key] = val;
        }
    }

    /**
     * Get all parameters from definitions
     * Processes parameters left-to-right to support cross-parameter references
     */
    getAll(defs: Record<string, ParamDefinition>): Record<string, any> {
        const res: Record<string, any> = {};
        for (const [k, def] of Object.entries(defs)) {
            const value = this.get(k, def);
            res[k] = value;
            // Store validated value in params so subsequent params can reference it
            if (value !== undefined) {
                this.params[k] = value;
            }
        }
        return res;
    }

    /**
     * Run all registered getters for a key
     */
    runAllRegisteredGetters(key: string): any {
        let val: any = null;
        for (const getter of this.paramGetters) {
            val = getter(key, this.definitions[key]);
            if (val !== undefined) {
                break;
            }
        }
        return val;
    }

    /**
     * Run all registered setters for a key
     */
    runAllRegisteredSetters(key: string, value: any): boolean {
        let setterUsed: boolean = false;
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
    registerParamGetter(fn: ParamGetter): void {
        this.paramGetters.push(fn);
    }

    /**
     * Register a parameter setter
     */
    registerParamSetter(fn: ParamSetter): void {
        this.paramSetters.push(fn);
    }
}

// Singleton instance
let paramsInstance: Params | null = null;

/**
 * Initialize the singleton Params instance
 */
export const init = (fns: { args: ArgsInstance }, opts: ParamsOptions = {}): Params => {
    paramsInstance = new Params(fns, opts);
    return paramsInstance;
};

/**
 * Get the current singleton Params instance
 */
export const getParamsInstance = (): Params | null => paramsInstance;

// Export custom types for external use
export { joiEdateType, joiStringArrayType };


