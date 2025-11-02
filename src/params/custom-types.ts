import Joi from "joi";
import { ParamError } from "../errors.js";

/**
 * Custom Joi type for enhanced date parsing with relative time support
 * Supports:
 * - ISO8601 strings: "2025-01-01T01:01:01Z"
 * - Relative time: "-2h", "+1d", "now"
 * - Cross-parameter references: "@startTime+2h", "@endDate-30m"
 * 
 * Internal representation: UTC ISO8601 string (YYYY-MM-DDTHH:mm:ssZ)
 * 
 * @param value - Date value to parse
 * @param helpers - Joi helpers (includes context with other params)
 * @returns ISO8601 string in UTC timezone
 */
export const joiEdateType = (value: any, helpers: Joi.CustomHelpers): string => {
    // If value is already a string in ISO format, validate and return
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) {
        const testDate = new Date(value);
        if (!isNaN(testDate.getTime())) {
            return value;
        }
    }

    // If value is a Date object, convert to ISO string
    if (value instanceof Date) {
        return value.toISOString();
    }

    // If value is not a string, try to convert it
    if (typeof value !== "string") {
        value = String(value);
    }

    // Handle special keyword "now"
    if (value.toLowerCase() === "now") {
        return new Date().toISOString();
    }

    // Check for cross-parameter reference with relative time: @paramName+2h, @paramName-30m
    const referenceRegex = /^@(\w+)([+-]\d+[smhdwy])$/i;
    const referenceMatch = value.match(referenceRegex);
    
    if (referenceMatch) {
        const [, paramName, relativeExpr] = referenceMatch;
        
        // Get the referenced parameter from context (if available via helpers.state.ancestors)
        // For now, we'll use helpers.prefs.context which Joi provides
        const context = (helpers as any).prefs?.context;
        
        if (!context || !context.params) {
            throw new ParamError(`Cannot resolve cross-parameter reference @${paramName}: context not available. Ensure parameters are processed with proper context.`);
        }

        const referencedValue = context.params[paramName];
        
        if (referencedValue === undefined || referencedValue === null) {
            throw new ParamError(`Cannot resolve @${paramName}: parameter "${paramName}" is not defined or has no value. Parameters are evaluated left-to-right.`);
        }

        // Referenced value should be an ISO string or Date
        let referenceDate: Date;
        if (referencedValue instanceof Date) {
            referenceDate = referencedValue;
        } else if (typeof referencedValue === "string") {
            referenceDate = new Date(referencedValue);
            if (isNaN(referenceDate.getTime())) {
                throw new ParamError(`Referenced parameter @${paramName} has invalid date value: ${referencedValue}`);
            }
        } else {
            throw new ParamError(`Referenced parameter @${paramName} is not a valid date type (found: ${typeof referencedValue})`);
        }

        // Parse the relative expression and apply to reference date
        const relativeMatch = relativeExpr.match(/^([+-])(\d+)([smhdwy])$/i);
        if (!relativeMatch) {
            throw new ParamError(`Invalid relative time expression in @${paramName}${relativeExpr}`);
        }

        const [, sign, amount, unit] = relativeMatch;
        const offset = calculateTimeOffset(parseInt(amount, 10), unit, sign);
        const resultDate = new Date(referenceDate.getTime() + offset);
        
        return resultDate.toISOString();
    }

    // Check for relative time expressions like "-2h", "+1d", "-30m", etc.
    const relativeTimeRegex = /^([+-])(\d+)([smhdwy])$/i;
    const relativeMatch = value.match(relativeTimeRegex);
    
    if (relativeMatch) {
        const [, sign, amount, unit] = relativeMatch;
        const numAmount = parseInt(amount, 10);
        
        if (isNaN(numAmount)) {
            throw new ParamError(`Invalid relative time amount: ${amount}`);
        }

        const offset = calculateTimeOffset(numAmount, unit, sign);
        const resultDate = new Date(Date.now() + offset);
        
        return resultDate.toISOString();
    }

    // Try to parse as a regular date string
    const parsedDate = new Date(value);
    
    // Check if the parsed date is valid
    if (isNaN(parsedDate.getTime())) {
        throw new ParamError(`Invalid date format: ${value}. Expected a valid date string, "now", relative time expression (e.g., "-2h", "+1d"), or cross-parameter reference (e.g., "@startTime+2h")`);
    }

    return parsedDate.toISOString();
};

/**
 * Calculate time offset in milliseconds
 */
function calculateTimeOffset(amount: number, unit: string, sign: string): number {
    let multiplier = 1;
    
    // Convert to milliseconds based on unit
    switch (unit.toLowerCase()) {
        case "s": // seconds
            multiplier = 1000;
            break;
        case "m": // minutes
            multiplier = 60 * 1000;
            break;
        case "h": // hours
            multiplier = 60 * 60 * 1000;
            break;
        case "d": // days
            multiplier = 24 * 60 * 60 * 1000;
            break;
        case "w": // weeks
            multiplier = 7 * 24 * 60 * 60 * 1000;
            break;
        case "y": // years (approximate)
            multiplier = 365 * 24 * 60 * 60 * 1000;
            break;
        default:
            throw new ParamError(`Invalid time unit: ${unit}. Supported units: s, m, h, d, w, y`);
    }

    return sign === "+" ? amount * multiplier : -amount * multiplier;
}

/**
 * Custom Joi type for string array parsing
 * Converts comma-separated strings to typed arrays
 */
export const joiStringArrayType = (type: string) => (value: any, helpers: Joi.CustomHelpers): any[] => {
    if (value === undefined || typeof value === "function") {
        return [];
    }
    
    const arr = value.split(/,\s*/).map((el: string) => {
        if (type === "number") {
            const v = parseInt(el, 10);
            if (isNaN(v)) {
                throw new ParamError(`array element "${el}" should be numeric`);
            }
            return v;
        } else if (type === "boolean") {
            const v = el.match(/true|t|yes|1/i) ? true :
                el.match(/false|f|no|0/i) ? false : null;
            if (v === null) {
                throw new ParamError(`array element "${el}" should be boolean`);
            }
            return v;
        } else if (type === "string") {
            return el;
        } else {
            throw new ParamError(`unknown type "${type}" for array elements`);
        }
    });
    
    return arr;
};

