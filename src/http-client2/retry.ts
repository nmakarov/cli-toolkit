/**
 * HttpClient Retry Logic (http-client2 - same as http-client)
 */

import type { RetryContext } from './types.js';

export function calculateRetryDelay(attempt: number, baseDelay: number, maxDelay: number, jitterFactor = 0.1): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    const jitter = cappedDelay * jitterFactor * Math.random();
    return Math.floor(cappedDelay + jitter);
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function shouldRetryError(classification: { retryable: boolean; isAuth: boolean }): boolean {
    if (classification.isAuth) return false;
    return classification.retryable;
}

export function createRetryContext(maxAttempts: number, baseDelay: number, maxDelay: number, jitterFactor: number): RetryContext {
    return {
        attempt: 1,
        maxAttempts,
        lastError: new Error('Initial attempt'),
        totalDelay: 0,
        nextDelay: calculateRetryDelay(1, baseDelay, maxDelay, jitterFactor)
    };
}

export function updateRetryContext(context: RetryContext, lastError: Error, baseDelay: number, maxDelay: number, jitterFactor: number): RetryContext {
    const nextAttempt = context.attempt + 1;
    return {
        attempt: nextAttempt,
        maxAttempts: context.maxAttempts,
        lastError,
        totalDelay: context.totalDelay + context.nextDelay,
        nextDelay: calculateRetryDelay(nextAttempt, baseDelay, maxDelay, jitterFactor)
    };
}
