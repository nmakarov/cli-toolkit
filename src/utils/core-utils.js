/**
 * Core lightweight utilities
 */

export function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toJsonColumn(value) {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}
