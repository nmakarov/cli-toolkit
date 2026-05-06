





export function calculateRetryDelay(attempt, baseDelay, maxDelay, jitterFactor = 0.1) {
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    const jitter = cappedDelay * jitterFactor * Math.random();
    return Math.floor(cappedDelay + jitter);
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function shouldRetryError(classification) {
    if (classification.isAuth) return false;
    return classification.retryable;
}

export function createRetryContext(maxAttempts, baseDelay, maxDelay, jitterFactor) {
    return {
        attempt: 1,
        maxAttempts,
        lastError: new Error("Initial attempt"),
        totalDelay: 0,
        nextDelay: calculateRetryDelay(1, baseDelay, maxDelay, jitterFactor)
    };
}

export function updateRetryContext(context, lastError, baseDelay, maxDelay, jitterFactor) {
    const nextAttempt = context.attempt + 1;
    return {
        attempt: nextAttempt,
        maxAttempts: context.maxAttempts,
        lastError,
        totalDelay: context.totalDelay + context.nextDelay,
        nextDelay: calculateRetryDelay(nextAttempt, baseDelay, maxDelay, jitterFactor)
    };
}
