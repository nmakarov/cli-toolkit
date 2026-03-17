/**
 * Core lightweight utilities
 */

export function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toJsonColumn(value: any): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}
