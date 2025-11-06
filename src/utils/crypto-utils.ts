/**
 * Cryptography Utilities
 * 
 * Helper functions for hashing, encryption, and data masking
 */

import crypto from "crypto";

/**
 * Calculate MD5 hash of a string (useful for content fingerprinting)
 */
export function md5(value: string): string {
    return crypto.createHash("md5").update(value).digest("hex");
}

/**
 * Sanitize sensitive data by replacing with MD5 hash
 * Useful for logging sensitive information while maintaining traceability
 */
export function maskValue(value: string): string {
    return `[md5:${md5(value)}]`;
}

