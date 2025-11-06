/**
 * Formatting Utilities
 * 
 * Helper functions for converting between different data formats
 * and human-readable representations
 */

/**
 * Convert bytes to human-readable format (e.g., "1.5 MB")
 */
export function bytesToHumanReadable(bytes: number): string {
    if (bytes === 0) return "0 B";
    
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Convert human-readable format to bytes (e.g., "1.5 MB" -> 1572864)
 */
export function humanReadableToBytes(humanString: string): number {
    const units: Record<string, number> = {
        "B": 1,
        "KB": 1024,
        "MB": 1024 * 1024,
        "GB": 1024 * 1024 * 1024,
        "TB": 1024 * 1024 * 1024 * 1024,
        "PB": 1024 * 1024 * 1024 * 1024 * 1024,
    };
    
    const match = humanString.trim().match(/^([\d.]+)\s*([A-Z]+)$/i);
    if (!match) {
        throw new Error(`Invalid format: ${humanString}. Expected format like "2MB" or "1.5 GB"`);
    }
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    if (!units[unit]) {
        throw new Error(`Unknown unit: ${unit}. Supported units: ${Object.keys(units).join(", ")}`);
    }
    
    return Math.round(value * units[unit]);
}

