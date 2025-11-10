/**
 * HttpClient Error Classification
 *
 * Maps technical errors to human-readable, use-case oriented error types
 */

import type { HttpClientErrorType, HttpClientStatus, ErrorClassification } from './types.js';

/**
 * Classify an error and determine retry behavior
 */
export function classifyError(error: any): ErrorClassification {
    // Handle axios response errors (HTTP errors)
    if (error.response) {
        const { status } = error.response;

        switch (status) {
            case 400:
                return { type: 'badRequest', retryable: false, isAuth: false, status: 'clientError' };
            case 401:
                return { type: 'unauthorized', retryable: false, isAuth: true, status: 'authRequired' };
            case 403:
                return { type: 'forbidden', retryable: false, isAuth: true, status: 'authFailed' };
            case 404:
                return { type: 'notFound', retryable: false, isAuth: false, status: 'clientError' };
            case 405:
                return { type: 'methodNotAllowed', retryable: false, isAuth: false, status: 'clientError' };
            case 409:
                return { type: 'conflict', retryable: false, isAuth: false, status: 'clientError' };
            case 422:
                return { type: 'unprocessableEntity', retryable: false, isAuth: false, status: 'clientError' };
            case 429:
                return { type: 'tooManyRequests', retryable: true, isAuth: false, status: 'clientError' };
            case 500:
                return { type: 'internalServerError', retryable: true, isAuth: false, status: 'serverError' };
            case 502:
                return { type: 'badGateway', retryable: true, isAuth: false, status: 'serverError' };
            case 503:
                return { type: 'serviceUnavailable', retryable: true, isAuth: false, status: 'serverError' };
            case 504:
                return { type: 'gatewayTimeout', retryable: true, isAuth: false, status: 'serverError' };
            default:
                if (status >= 400 && status < 500) {
                    return { type: 'clientError' as HttpClientErrorType, retryable: false, isAuth: false, status: 'clientError' };
                } else if (status >= 500) {
                    return { type: 'serverError' as HttpClientErrorType, retryable: true, isAuth: false, status: 'serverError' };
                }
                break;
        }
    }

    // Handle network/connection errors (no response)
    if (error.code) {
        switch (error.code) {
            case 'ECONNREFUSED':
            case 'ECONNRESET':
            case 'EPIPE':
            case 'ENOTFOUND':
            case 'EHOSTUNREACH':
            case 'ENETUNREACH':
                return { type: 'connectionFailed', retryable: true, isAuth: false, status: 'networkError' };

            case 'ETIMEDOUT':
            case 'ECONNABORTED':
            case 'ESOCKETTIMEDOUT':
                return { type: 'timeout', retryable: true, isAuth: false, status: 'timeout' };

            case 'EAUTH':
            case 'EACCES':
                return { type: 'unauthorized', retryable: false, isAuth: true, status: 'authRequired' };

            default:
                return { type: 'networkError', retryable: true, isAuth: false, status: 'networkError' };
        }
    }

    // Handle timeout errors
    if (error.message && (
        error.message.includes('timeout') ||
        error.message.includes('TIMEOUT') ||
        error.message.includes('aborted')
    )) {
        return { type: 'timeout', retryable: true, isAuth: false, status: 'timeout' };
    }

    // Handle cancellation
    if (error.name === 'AbortError' || error.message?.includes('cancelled')) {
        return { type: 'requestCancelled', retryable: false, isAuth: false, status: 'unknown' };
    }

    // Default fallback
    return { type: 'unknown', retryable: false, isAuth: false, status: 'unknown' };
}

/**
 * Get a human-readable description for an error type
 */
export function getErrorDescription(errorType: HttpClientErrorType): string {
    const descriptions: Record<HttpClientErrorType, string> = {
        connectionFailed: 'Failed to establish a connection to the server',
        timeout: 'Request timed out before completing',
        networkError: 'Network connection issue occurred',
        badRequest: 'Request was malformed or invalid',
        unauthorized: 'Authentication credentials are required',
        forbidden: 'Access to the requested resource is forbidden',
        notFound: 'The requested resource was not found',
        methodNotAllowed: 'HTTP method not allowed for this resource',
        conflict: 'Request conflicts with current server state',
        unprocessableEntity: 'Request data could not be processed',
        tooManyRequests: 'Too many requests sent in a short time',
        internalServerError: 'Server encountered an internal error',
        badGateway: 'Invalid response from upstream server',
        serviceUnavailable: 'Server is temporarily unavailable',
        gatewayTimeout: 'Upstream server timed out',
        unknown: 'An unknown error occurred',
        requestCancelled: 'Request was cancelled before completion'
    };

    return descriptions[errorType] || 'An unknown error occurred';
}
