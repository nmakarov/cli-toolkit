/**
 * MockServer Data Sanitization
 *
 * Handles masking of sensitive data in requests and responses for mock storage
 */

import { createHash } from 'crypto';
import { parse, stringify } from 'querystring';

/**
 * Create MD5 hash of a value for masking
 */
export function maskValue(value: string): string {
    return `[md5:${createHash('md5').update(value).digest('hex')}]`;
}

/**
 * Sanitize URL-encoded query string by masking sensitive parameters
 */
export function sanitizeUrlEncodedString(input: string, keysToSanitize: string[]): string {
    const parsed = parse(input);
    const sanitized = sanitizeObject(parsed, keysToSanitize);
    return stringify(sanitized);
}

/**
 * Sanitize object by masking sensitive keys
 */
export function sanitizeObject(obj: Record<string, any>, keysToSanitize: string[]): Record<string, any> {
    if (Array.isArray(obj)) {
        // For arrays, return as-is since we don't sanitize array elements
        return obj;
    }

    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj || {})) {
        if (keysToSanitize.includes(key.toLowerCase())) {
            result[key] = maskValue(String(value));
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Recursively sanitize nested objects
            result[key] = sanitizeObject(value, keysToSanitize);
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Sanitize headers by masking authorization and other sensitive headers
 */
export function sanitizeHeaders(headers: Record<string, string>, additionalKeys: string[] = []): Record<string, string> {
    const sensitiveKeys = ['authorization', 'x-api-key', 'api-key', 'bearer', ...additionalKeys.map(k => k.toLowerCase())];
    const sanitized = { ...headers };

    for (const [key, value] of Object.entries(sanitized)) {
        if (sensitiveKeys.includes(key.toLowerCase())) {
            sanitized[key] = maskValue(value);
        }
    }

    return sanitized;
}

/**
 * Sanitize request data for mock storage
 */
export function sanitizeRequestData(data: any, keysToSanitize: string[]): any {
    if (typeof data === 'string') {
        // Only try to parse as URL-encoded if it contains '=' (key=value pattern)
        if (data.includes('=')) {
            try {
                const parsed = parse(data);
                return stringify(sanitizeObject(parsed, keysToSanitize));
            } catch {
                // If parsing fails, treat as plain string
                return data;
            }
        }
        // Plain string without '=', return as-is
        return data;
    } else if (typeof data === 'object' && data !== null) {
        return sanitizeObject(data, keysToSanitize);
    }

    return data;
}

/**
 * Sanitize response data for mock storage
 */
export function sanitizeResponseData(data: any, keysToSanitize: string[]): any {
    if (typeof data === 'object' && data !== null) {
        return sanitizeObject(data, keysToSanitize);
    }
    return data;
}

/**
 * Complete request sanitization for mock storage
 */
export function sanitizeRequest(params: {
    query: string;
    requestData?: any;
    headers?: Record<string, string>;
    data?: any;
}, sensitiveKeys: string[]): {
    query: string;
    requestData?: any;
    headers: Record<string, string>;
    data: any;
} {
    const { query, requestData, headers = {}, data } = params;

    return {
        query: sanitizeUrlEncodedString(query, sensitiveKeys),
        requestData: requestData ? sanitizeRequestData(requestData, sensitiveKeys) : undefined,
        headers: sanitizeHeaders(headers, sensitiveKeys),
        data: data ? sanitizeResponseData(data, sensitiveKeys) : data
    };
}
