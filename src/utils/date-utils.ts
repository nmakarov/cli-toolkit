/**
 * Date/time utility functions for timestamp formatting and timezone conversions
 */

export interface DateFormatOptions {
    timezone?: "UTC" | "user";
    format?: "iso" | "iso-date" | "iso-time" | "human";
}

/**
 * Format a date string or Date object to ISO8601 format in specified timezone
 * Always returns UTC-based ISO strings (YYYY-MM-DDTHH:mm:ssZ) as internal representation
 * 
 * @param value - Date object, ISO string, or timestamp
 * @param options - Formatting options
 * @returns ISO8601 formatted string
 */
export function formatDate(value: Date | string | number | undefined, options: DateFormatOptions = {}): string {
    if (value === undefined || value === null) {
        return "";
    }

    const { timezone = "UTC", format = "iso" } = options;
    
    let date: Date;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === "string") {
        date = new Date(value);
    } else if (typeof value === "number") {
        date = new Date(value);
    } else {
        return "";
    }

    if (isNaN(date.getTime())) {
        return "";
    }

    // Format based on requested format
    switch (format) {
        case "iso":
            // Full ISO8601: 2025-01-01T01:01:01Z
            return date.toISOString();
        
        case "iso-date":
            // Date only: 2025-01-01
            return date.toISOString().split("T")[0];
        
        case "iso-time":
            // Time only: 01:01:01Z
            return date.toISOString().split("T")[1];
        
        case "human":
            // Human-readable: Jan 1, 2025 01:01:01 UTC
            if (timezone === "user") {
                return date.toLocaleString();
            }
            return date.toUTCString();
        
        default:
            return date.toISOString();
    }
}

/**
 * Parse a date value and return ISO8601 string in UTC
 * This is the canonical format for internal storage
 * 
 * @param value - Date object or string
 * @returns ISO8601 string in UTC timezone
 */
export function toISOString(value: Date | string | number | undefined): string {
    return formatDate(value, { timezone: "UTC", format: "iso" });
}

/**
 * Get current timestamp as ISO8601 string in UTC
 * @returns Current time as ISO8601 string
 */
export function nowISO(): string {
    return new Date().toISOString();
}

/**
 * Parse ISO8601 string to Date object
 * @param isoString - ISO8601 formatted string
 * @returns Date object
 */
export function fromISOString(isoString: string): Date {
    return new Date(isoString);
}

/**
 * Calculate difference between two dates in various units
 * @param start - Start date (ISO string or Date)
 * @param end - End date (ISO string or Date)
 * @returns Object with duration in multiple units
 */
export function dateDiff(
    start: Date | string,
    end: Date | string
): {
    milliseconds: number;
    seconds: number;
    minutes: number;
    hours: number;
    days: number;
} {
    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);
    
    const diffMs = endDate.getTime() - startDate.getTime();
    
    return {
        milliseconds: diffMs,
        seconds: Math.floor(diffMs / 1000),
        minutes: Math.floor(diffMs / (1000 * 60)),
        hours: Math.floor(diffMs / (1000 * 60 * 60)),
        days: Math.floor(diffMs / (1000 * 60 * 60 * 24))
    };
}

/**
 * Check if a folder name looks like an ISO8601 timestamp
 * Used to identify version folders vs regular folders
 * @param folderName - Folder name to check
 * @returns true if the folder name is a valid ISO8601 timestamp
 */
export function isTimestampFolder(folderName: string): boolean {
    // Match ISO8601 format: YYYY-MM-DDTHH:mm:ssZ
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|\.\d{3}Z)$/;
    
    if (!isoRegex.test(folderName)) {
        return false;
    }
    
    const date = new Date(folderName);
    return !isNaN(date.getTime()) && date.getTime() > 0;
}

/**
 * Generate a new version name (ISO8601 timestamp)
 * If existingVersions provided, ensures the new version is later than all existing ones
 * @param existingVersions - Array of existing version timestamps
 * @returns New version timestamp that is unique and later than existing ones
 */
export function generateVersionName(existingVersions: string[] = []): string {
    if (existingVersions.length === 0) {
        // No existing versions, use current timestamp
        const now = new Date();
        return now.toISOString().split(".")[0] + "Z";
    }
    
    // Find the maximum timestamp among all existing versions
    const maxTimestamp = existingVersions.reduce((max, version) => {
        const versionDate = new Date(version);
        const maxDate = new Date(max);
        return versionDate > maxDate ? version : max;
    });
    
    // Increment by 1 second to ensure uniqueness
    const maxDate = new Date(maxTimestamp);
    const nextDate = new Date(maxDate.getTime() + 1000);
    
    return nextDate.toISOString().split(".")[0] + "Z";
}

