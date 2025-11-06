/**
 * FileStore Serializers
 * 
 * Data type detection and serialization/deserialization utilities
 */

import type { DataType } from "./types.js";

/**
 * Detect the data type of a given value
 */
export function detectDataType(data: any): DataType {
    if (Array.isArray(data)) {
        return "json-array";
    } else if (typeof data === "object" && data !== null) {
        return "json-object";
    } else if (typeof data === "string") {
        // Try to detect if it's XML
        const trimmed = data.trim();
        if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
            return "xml";
        }
        return "text";
    } else {
        return "text";
    }
}

/**
 * Serialize data to a string for file storage
 */
export function serializeData(data: any): string {
    const dataType = detectDataType(data);
    
    if (dataType === "json-array" || dataType === "json-object") {
        return JSON.stringify(data, null, 4);
    } else {
        // For text and XML, return as-is
        return String(data);
    }
}

/**
 * Deserialize data from a string based on data type
 */
export function deserializeData(rawData: string, dataType: DataType): any {
    if (dataType === "json-array" || dataType === "json-object") {
        return JSON.parse(rawData);
    } else {
        // For text and XML, return as-is
        return rawData;
    }
}

