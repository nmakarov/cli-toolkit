/**
 * HttpClient Types
 *
 * Type definitions for the HttpClient module - a resilient HTTP client with retry logic
 */

/**
 * HTTP methods supported by HttpClient
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * Human-readable error types for better developer experience
 */
export type HttpClientErrorType =
    // Network/Connection Errors
    | 'connectionFailed'        // Connection refused/reset/unreachable
    | 'timeout'                 // Request timeout
    | 'networkError'            // General network issues

    // HTTP Client Errors (4xx)
    | 'badRequest'              // 400 Bad Request
    | 'unauthorized'            // 401 Unauthorized
    | 'forbidden'               // 403 Forbidden
    | 'notFound'                // 404 Not Found
    | 'methodNotAllowed'        // 405 Method Not Allowed
    | 'conflict'                // 409 Conflict
    | 'unprocessableEntity'     // 422 Unprocessable Entity
    | 'tooManyRequests'         // 429 Too Many Requests

    // HTTP Server Errors (5xx)
    | 'internalServerError'     // 500 Internal Server Error
    | 'badGateway'              // 502 Bad Gateway
    | 'serviceUnavailable'      // 503 Service Unavailable
    | 'gatewayTimeout'          // 504 Gateway Timeout

    // Other
    | 'unknown'                 // Unknown/unclassified error
    | 'requestCancelled';       // Request was cancelled

/**
 * Custom status types for unified response handling
 */
export type HttpClientStatus =
    | 'success'                 // 2xx responses
    | 'authRequired'            // 401 responses
    | 'authFailed'              // 403 responses
    | 'clientError'             // Other 4xx responses
    | 'serverError'             // 5xx responses
    | 'networkError'            // Network/connection issues
    | 'timeout'                 // Request timeout
    | 'unknown';                // Unknown status

/**
 * HttpClient configuration options
 */
export interface HttpClientConfig {
    /** Base timeout for requests in milliseconds - default: 30000 (30s) */
    timeout?: number;
    /** Maximum number of retry attempts - default: 3 */
    retryCount?: number;
    /** Base delay between retries in milliseconds - default: 1000 (1s) */
    retryDelay?: number;
    /** Maximum retry delay in milliseconds - default: 30000 (30s) */
    maxRetryDelay?: number;
    /** Jitter factor for retry delays (0-1) - default: 0.1 (10%) */
    retryJitter?: number;
    /** User agent string - default: HttpClient/v1.0 */
    userAgent?: string;
    /** Whether to validate SSL certificates - default: true */
    validateSSL?: boolean;
    /** Maximum number of redirects to follow - default: 5 */
    maxRedirects?: number;
    /** Logger instance for debug/info/error logging */
    logger?: any;
}

/**
 * Request options that can be passed to individual requests
 */
export interface RequestOptions {
    /** Request timeout override (milliseconds) */
    timeout?: number;
    /** Headers to include in the request */
    headers?: Record<string, string>;
    /** Query parameters */
    params?: Record<string, any>;
    /** Request body data */
    data?: any;
    /** Override retry count for this request */
    retryCount?: number;
    /** Override retry delay for this request */
    retryDelay?: number;
    /** Whether to log request/response details */
    debug?: boolean;
    /** Custom user agent for this request */
    userAgent?: string;
}

/**
 * Unified response format - HttpClient never throws, always returns this structure
 */
export interface HttpClientResponse {
    /** Custom status (success, authRequired, clientError, etc.) */
    status: HttpClientStatus;
    /** HTTP status code (200, 404, 500, etc.) */
    code: number | null;
    /** Human-readable error type (if applicable) */
    error?: HttpClientErrorType;
    /** Response headers */
    headers: Record<string, string> | null;
    /** Response data */
    data: any;
    /** Request duration in milliseconds */
    duration: number;
    /** Number of retry attempts made */
    retryCount: number;
    /** Final URL after redirects (if any) */
    finalUrl?: string;
}

/**
 * Retry context for tracking retry attempts
 */
export interface RetryContext {
    /** Current attempt number (1-based) */
    attempt: number;
    /** Maximum attempts allowed */
    maxAttempts: number;
    /** Last error that occurred */
    lastError: Error;
    /** Total delay accumulated so far */
    totalDelay: number;
    /** Next retry delay */
    nextDelay: number;
}

/**
 * Error classification result
 */
export interface ErrorClassification {
    /** Human-readable error type */
    type: HttpClientErrorType;
    /** Whether this error is retryable */
    retryable: boolean;
    /** Whether this error indicates authentication issues */
    isAuth: boolean;
    /** Custom status for this error */
    status: HttpClientStatus;
}
