/**
 * HttpClient Types (http-client2 - drop-in compatible)
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export type HttpClientErrorType =
    | 'connectionFailed'
    | 'timeout'
    | 'networkError'
    | 'badRequest'
    | 'unauthorized'
    | 'forbidden'
    | 'notFound'
    | 'methodNotAllowed'
    | 'conflict'
    | 'unprocessableEntity'
    | 'tooManyRequests'
    | 'internalServerError'
    | 'badGateway'
    | 'serviceUnavailable'
    | 'gatewayTimeout'
    | 'unknown'
    | 'requestCancelled';

export type HttpClientStatus =
    | 'success'
    | 'authRequired'
    | 'authFailed'
    | 'clientError'
    | 'serverError'
    | 'networkError'
    | 'timeout'
    | 'unknown';

export interface HttpClientConfig {
    timeout?: number;
    retryCount?: number;
    retryDelay?: number;
    maxRetryDelay?: number;
    retryJitter?: number;
    userAgent?: string;
    validateSSL?: boolean;
    maxRedirects?: number;
    baseURL?: string;
    logger?: any;
}

export interface RequestOptions {
    timeout?: number;
    headers?: Record<string, string>;
    params?: Record<string, any>;
    data?: any;
    retryCount?: number;
    retryDelay?: number;
    debug?: boolean;
    userAgent?: string;
}

export interface HttpClientResponse {
    status: HttpClientStatus;
    code: number | null;
    error?: HttpClientErrorType;
    headers: Record<string, string> | null;
    data: any;
    duration: number;
    retryCount: number;
    finalUrl?: string;
}

export interface RetryContext {
    attempt: number;
    maxAttempts: number;
    lastError: Error;
    totalDelay: number;
    nextDelay: number;
}

export interface ErrorClassification {
    type: HttpClientErrorType;
    retryable: boolean;
    isAuth: boolean;
    status: HttpClientStatus;
}
