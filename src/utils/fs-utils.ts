/**
 * File System Utilities
 * 
 * Helper functions for file system operations like path management,
 * directory creation, and file type detection
 */

import fs from "fs";
import path from "path";

/**
 * Ensure a directory path exists, creating it if necessary
 * Returns the absolute path
 */
export async function ensurePath(...pathParts: string[]): Promise<string> {
    const fullPath = path.resolve(...pathParts);
    
    if (!fs.existsSync(fullPath)) {
        await fs.promises.mkdir(fullPath, { recursive: true });
    }
    
    return fullPath;
}

/**
 * Synchronous version of ensurePath
 */
export function ensurePathSync(...pathParts: string[]): string {
    const fullPath = path.resolve(...pathParts);
    
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
    
    return fullPath;
}

/**
 * Get file extension for a given data type
 */
export function getFileExtension(dataType: string): string {
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

