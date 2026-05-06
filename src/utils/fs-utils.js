/**
 * File System Utilities
 * 
 * Helper functions for file system operations like path management,
 * directory creation, and file type detection
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Ensure a directory path exists, creating it if necessary
 * Returns the absolute path
 */
export async function ensurePath(...pathParts) {
    const fullPath = path.resolve(...pathParts);
    
    if (!fs.existsSync(fullPath)) {
        await fs.promises.mkdir(fullPath, { recursive: true });
    }
    
    return fullPath;
}

/**
 * Synchronous version of ensurePath
 */
export function ensurePathSync(...pathParts) {
    const fullPath = path.resolve(...pathParts);
    
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
    
    return fullPath;
}

/**
 * Get file extension for a given data type
 */
export function getFileExtension(dataType) {
    switch (dataType) {
        case "json-array":
        case "json-object":
            return "json";
        case "text":
            return "txt";
        case "xml":
            return "xml";
        default:
            return "json";
    }
}

/**
 * Get __dirname equivalent for ES modules
 * 
 * Returns the directory path of the module file
 * Useful for resolving relative paths in ES modules where __dirname is not available
 * 
 * @param metaUrl - The import.meta.url from the calling module (must be passed from calling module)
 * @returns The directory path of the module
 * 
 * @example
 * ```typescript
 * import { getDirname } from "@nmakarov/cli-toolkit/utils";
 * const __dirname = getDirname(import.meta.url);
 * ```
 */
export function getDirname(metaUrl) {
    return path.dirname(fileURLToPath(metaUrl));
}

