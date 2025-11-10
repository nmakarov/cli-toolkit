/**
 * HttpClient Retry Logic
 *
 * Implements exponential backoff with jitter to prevent thundering herd problems
 */

import type { RetryContext } from './types.js';

/**
 * Calculate the next retry delay using exponential backoff with jitter
 *
 * Formula: delay = baseDelay * (2 ^ (attempt - 1)) + randomJitter
 *
 * Jitter prevents the "thundering herd" problem where multiple failed requests
 * all retry at the exact same time, overwhelming the server.
 */
export function calculateRetryDelay(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
    jitterFactor: number = 0.1
): number {
    // Exponential backoff: baseDelay * (2 ^ (attempt - 1))
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);

    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, maxDelay);

    // Add jitter: random variation up to jitterFactor of the delay
    const jitter = cappedDelay * jitterFactor * Math.random();

    return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for the specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine if an error should be retried based on classification
 */
export function shouldRetryError(classification: { retryable: boolean; isAuth: boolean }): boolean {
    // Never retry auth errors (they won't succeed with the same credentials)
    if (classification.isAuth) {
        return false;
    }

    // Retry if the error is classified as retryable
    return classification.retryable;
}

/**
 * Create a retry context for tracking retry attempts
 */
export function createRetryContext(
    maxAttempts: number,
    baseDelay: number,
    maxDelay: number,
    jitterFactor: number
): RetryContext {
    return {
        attempt: 1,
        maxAttempts,
        lastError: new Error('Initial attempt'),
        totalDelay: 0,
        nextDelay: calculateRetryDelay(1, baseDelay, maxDelay, jitterFactor)
    };
}

/**
 * Update retry context for the next attempt
 */
export function updateRetryContext(
    context: RetryContext,
    lastError: Error,
    baseDelay: number,
    maxDelay: number,
    jitterFactor: number
): RetryContext {
    const nextAttempt = context.attempt + 1;
    const nextDelay = calculateRetryDelay(nextAttempt, baseDelay, maxDelay, jitterFactor);

    return {
        attempt: nextAttempt,
        maxAttempts: context.maxAttempts,
        lastError,
        totalDelay: context.totalDelay + context.nextDelay,
        nextDelay
    };
}
