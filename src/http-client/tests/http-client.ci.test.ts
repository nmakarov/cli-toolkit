import { describe, it, expect, beforeEach, vi } from "vitest";
import { HttpClient, HttpClientError } from "../index.js";
import { classifyError, getErrorDescription } from "../errors.js";
import { calculateRetryDelay, shouldRetryError, createRetryContext, updateRetryContext } from "../retry.js";
import type { HttpClientResponse } from "../types.js";

// Mock axios for testing
vi.mock('axios', () => {
    const mockAxios = {
        create: vi.fn(() => ({
            request: vi.fn(),
            interceptors: {
                response: {
                    use: vi.fn()
                }
            }
        })),
        isAxiosError: vi.fn((error) => error.isAxiosError === true)
    };
    return {
        default: mockAxios,
        ...mockAxios
    };
});

import axios from 'axios';

// Control whether to use real timeouts or fake timers for faster CI tests
const USE_REAL_TIMEOUTS = process.env.HTTP_CLIENT_REAL_TIMEOUTS === 'true';

describe("HttpClient CI", () => {
    let client: HttpClient;
    let mockAxiosInstance: any;

    beforeAll(() => {
        // Use fake timers by default for fast CI tests, real timers when explicitly requested
        if (!USE_REAL_TIMEOUTS) {
            vi.useFakeTimers();
        }
    });

    afterAll(() => {
        if (!USE_REAL_TIMEOUTS) {
            vi.useRealTimers();
        }
    });

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset axios.create mock
        mockAxiosInstance = {
            request: vi.fn(),
            interceptors: {
                response: {
                    use: vi.fn()
                }
            }
        };
        (axios.create as any).mockReturnValue(mockAxiosInstance);

        client = new HttpClient({
            timeout: 5000,
            retryCount: 2,
            logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
        });
    });

    it("creates HttpClient instance with default config", () => {
        const defaultClient = new HttpClient();
        expect(defaultClient).toBeDefined();
        expect(axios.create).toHaveBeenCalled();
    });

    it("configures axios instance correctly", () => {
        expect(axios.create).toHaveBeenCalledWith({
            timeout: 5000,
            validateStatus: expect.any(Function),
            maxRedirects: 5,
            headers: {
                'User-Agent': 'HttpClient/v1.0'
            }
        });
    });

    it("handles successful GET request", async () => {
        const mockResponse = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            data: { success: true },
            request: { res: { responseUrl: 'http://example.com' } }
        };

        mockAxiosInstance.request.mockResolvedValue(mockResponse);

        const response = await client.get('http://example.com');

        expect(response).toEqual({
            status: 'success',
            code: 200,
            headers: { 'content-type': 'application/json' },
            data: { success: true },
            duration: expect.any(Number),
            retryCount: 0,
            finalUrl: 'http://example.com'
        });

        expect(mockAxiosInstance.request).toHaveBeenCalledWith({
            method: 'GET',
            url: 'http://example.com',
            timeout: 5000,
            headers: { 'User-Agent': 'HttpClient/v1.0' },
            params: undefined,
            data: undefined
        });
    });

    it("handles 404 error without retry", async () => {
        const mockError = {
            response: {
                status: 404,
                headers: { 'content-type': 'application/json' },
                data: { error: 'Not found' }
            },
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const response = await client.get('http://example.com/missing');

        expect(response).toEqual({
            status: 'clientError',
            code: 404,
            error: 'notFound',
            headers: { 'content-type': 'application/json' },
            data: { error: 'Not found' },
            duration: expect.any(Number),
            retryCount: 0,
            finalUrl: 'http://example.com/missing'
        });

        // Should not retry for 404
        expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it("handles network error with retry", async () => {
        const mockError = {
            code: 'ECONNREFUSED',
            isAxiosError: true
        };

        // First call fails, second succeeds
        mockAxiosInstance.request
            .mockRejectedValueOnce(mockError)
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: { success: true }
            });

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timer to trigger retry
            vi.advanceTimersByTime(1000);
            await vi.runOnlyPendingTimersAsync();
        }

        const response = await responsePromise;

        expect(response.status).toBe('success');
        expect(response.retryCount).toBe(1);
        expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it("gives up after max retries on network error", async () => {
        const mockError = {
            code: 'ECONNRESET',
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timers for all retry attempts (3 total: initial + 2 retries)
            for (let i = 0; i < 2; i++) {
                vi.advanceTimersByTime(1000);
                await vi.runOnlyPendingTimersAsync();
            }
        }

        const response = await responsePromise;

        expect(response).toEqual({
            status: 'networkError',
            code: null,
            error: 'connectionFailed',
            headers: null,
            data: null,
            duration: expect.any(Number),
            retryCount: 2, // retryCount is 2, so 3 total attempts
            finalUrl: 'http://example.com'
        });

        expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });

    it("handles timeout error", async () => {
        const mockError = {
            code: 'ECONNABORTED',
            message: 'timeout',
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timers for retries
            for (let i = 0; i < 2; i++) {
                vi.advanceTimersByTime(1000);
                await vi.runOnlyPendingTimersAsync();
            }
        }

        const response = await responsePromise;

        expect(response.status).toBe('timeout');
        expect(response.error).toBe('timeout');
        expect(response.retryCount).toBeGreaterThan(0);
    });

    it("supports POST method", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 201,
            headers: {},
            data: { created: true }
        });

        const response = await client.post('http://example.com/users', {
            data: { name: 'John' }
        });

        expect(response.status).toBe('success');
        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                url: 'http://example.com/users',
                data: { name: 'John' }
            })
        );
    });

    it("supports custom headers", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 200,
            headers: {},
            data: {}
        });

        await client.get('http://example.com', {
            headers: { 'Authorization': 'Bearer token123' }
        });

        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                headers: expect.objectContaining({
                    'User-Agent': 'HttpClient/v1.0',
                    'Authorization': 'Bearer token123'
                })
            })
        );
    });

    it("supports query parameters", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 200,
            headers: {},
            data: {}
        });

        await client.get('http://example.com/search', {
            params: { q: 'test', limit: 10 }
        });

        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                params: { q: 'test', limit: 10 }
            })
        );
    });

    it("maps HTTP status codes to custom statuses", async () => {
        const testCases = [
            { status: 200, expected: 'success' },
            { status: 201, expected: 'success' },
            { status: 401, expected: 'authRequired' },
            { status: 403, expected: 'authFailed' },
            { status: 404, expected: 'clientError' },
            { status: 500, expected: 'serverError' }
        ];

        for (const { status, expected } of testCases) {
            mockAxiosInstance.request.mockResolvedValueOnce({
                status,
                headers: {},
                data: {}
            });

            const response = await client.get('http://example.com');
            expect(response.status).toBe(expected);
        }
    });

    it("respects per-request timeout override", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 200,
            headers: {},
            data: {}
        });

        await client.get('http://example.com', { timeout: 10000 });

        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                timeout: 10000
            })
        );
    });

    it("handles debug mode", async () => {
        const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const debugClient = new HttpClient({ logger });

        mockAxiosInstance.request.mockResolvedValue({
            status: 200,
            headers: {},
            data: {}
        });

        await debugClient.get('http://example.com', { debug: true });

        expect(logger.debug).toHaveBeenCalled();
    });

    it("supports PUT method", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 204,
            headers: {},
            data: null
        });

        const response = await client.put('http://example.com/resource/1', {
            data: { name: 'Updated' }
        });

        expect(response.status).toBe('success');
        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'PUT',
                url: 'http://example.com/resource/1',
                data: { name: 'Updated' }
            })
        );
    });

    it("supports PATCH method", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 200,
            headers: {},
            data: { updated: true }
        });

        const response = await client.patch('http://example.com/resource/1', {
            data: { name: 'Patched' }
        });

        expect(response.status).toBe('success');
        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'PATCH'
            })
        );
    });

    it("supports DELETE method", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 204,
            headers: {},
            data: null
        });

        const response = await client.delete('http://example.com/resource/1');

        expect(response.status).toBe('success');
        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'DELETE'
            })
        );
    });

    it("supports OPTIONS method", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 200,
            headers: { 'allow': 'GET, POST, PUT, DELETE' },
            data: null
        });

        const response = await client.options('http://example.com/resource');

        expect(response.status).toBe('success');
        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'OPTIONS'
            })
        );
    });

    it("supports HEAD method", async () => {
        mockAxiosInstance.request.mockResolvedValue({
            status: 200,
            headers: { 'content-length': '1234' },
            data: null
        });

        const response = await client.head('http://example.com/resource');

        expect(response.status).toBe('success');
        expect(mockAxiosInstance.request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'HEAD'
            })
        );
    });

    it("handles 400 Bad Request", async () => {
        const mockError = {
            response: {
                status: 400,
                headers: {},
                data: { error: 'Bad request' }
            },
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const response = await client.post('http://example.com', { data: {} });

        expect(response.status).toBe('clientError');
        expect(response.error).toBe('badRequest');
        expect(response.code).toBe(400);
    });

    it("handles 405 Method Not Allowed", async () => {
        const mockError = {
            response: {
                status: 405,
                headers: { 'allow': 'GET, POST' },
                data: { error: 'Method not allowed' }
            },
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const response = await client.put('http://example.com', { data: {} });

        expect(response.status).toBe('clientError');
        expect(response.error).toBe('methodNotAllowed');
        expect(response.code).toBe(405);
    });

    it("handles 409 Conflict", async () => {
        const mockError = {
            response: {
                status: 409,
                headers: {},
                data: { error: 'Conflict' }
            },
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const response = await client.post('http://example.com', { data: {} });

        expect(response.status).toBe('clientError');
        expect(response.error).toBe('conflict');
        expect(response.code).toBe(409);
    });

    it("handles 422 Unprocessable Entity", async () => {
        const mockError = {
            response: {
                status: 422,
                headers: {},
                data: { error: 'Validation failed' }
            },
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const response = await client.post('http://example.com', { data: {} });

        expect(response.status).toBe('clientError');
        expect(response.error).toBe('unprocessableEntity');
        expect(response.code).toBe(422);
    });

    it("handles 429 Too Many Requests with retry", async () => {
        const mockError = {
            response: {
                status: 429,
                headers: { 'retry-after': '60' },
                data: { error: 'Rate limited' }
            },
            isAxiosError: true
        };

        mockAxiosInstance.request
            .mockRejectedValueOnce(mockError)
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: { success: true }
            });

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timer to trigger retry
            vi.advanceTimersByTime(1000);
            await vi.runOnlyPendingTimersAsync();
        }

        const response = await responsePromise;

        expect(response.status).toBe('success');
        expect(response.retryCount).toBe(1);
        expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it("handles 5xx server errors with retry", async () => {
        const mockError = {
            response: {
                status: 503,
                headers: {},
                data: { error: 'Service unavailable' }
            },
            isAxiosError: true
        };

        mockAxiosInstance.request
            .mockRejectedValueOnce(mockError)
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                data: { success: true }
            });

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timer to trigger retry
            vi.advanceTimersByTime(1000);
            await vi.runOnlyPendingTimersAsync();
        }

        const response = await responsePromise;

        expect(response.status).toBe('success');
        expect(response.retryCount).toBe(1);
        expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it("handles ECONNREFUSED network error", async () => {
        const mockError = {
            code: 'ECONNREFUSED',
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timers for retries
            for (let i = 0; i < 2; i++) {
                vi.advanceTimersByTime(1000);
                await vi.runOnlyPendingTimersAsync();
            }
        }

        const response = await responsePromise;

        expect(response.status).toBe('networkError');
        expect(response.error).toBe('connectionFailed');
        expect(response.retryCount).toBeGreaterThan(0);
    });

    it("handles EHOSTUNREACH network error", async () => {
        const mockError = {
            code: 'EHOSTUNREACH',
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timers for retries
            for (let i = 0; i < 2; i++) {
                vi.advanceTimersByTime(1000);
                await vi.runOnlyPendingTimersAsync();
            }
        }

        const response = await responsePromise;

        expect(response.status).toBe('networkError');
        expect(response.error).toBe('connectionFailed');
        expect(response.retryCount).toBeGreaterThan(0);
    });

    it("handles ENOTFOUND network error", async () => {
        const mockError = {
            code: 'ENOTFOUND',
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timers for retries
            for (let i = 0; i < 2; i++) {
                vi.advanceTimersByTime(1000);
                await vi.runOnlyPendingTimersAsync();
            }
        }

        const response = await responsePromise;

        expect(response.status).toBe('networkError');
        expect(response.error).toBe('connectionFailed');
        expect(response.retryCount).toBeGreaterThan(0);
    });

    it("handles ESOCKETTIMEDOUT network error", async () => {
        const mockError = {
            code: 'ESOCKETTIMEDOUT',
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            // Advance timers for retries
            for (let i = 0; i < 2; i++) {
                vi.advanceTimersByTime(1000);
                await vi.runOnlyPendingTimersAsync();
            }
        }

        const response = await responsePromise;

        expect(response.status).toBe('timeout');
        expect(response.error).toBe('timeout');
        expect(response.retryCount).toBeGreaterThan(0);
    });

    it("handles AbortError for cancelled requests", async () => {
        const mockError = {
            name: 'AbortError',
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const response = await client.get('http://example.com');

        expect(response.status).toBe('unknown');
        expect(response.error).toBe('requestCancelled');
        expect(response.retryCount).toBe(0);
    });

    it("handles generic unknown errors", async () => {
        const mockError = {
            message: 'Unknown error occurred',
            isAxiosError: true
        };

        mockAxiosInstance.request.mockRejectedValue(mockError);

        const response = await client.get('http://example.com');

        expect(response.status).toBe('unknown');
        expect(response.error).toBe('unknown');
        expect(response.retryCount).toBe(0);
    });

    it("handles null config gracefully", () => {
        const nullClient = new HttpClient(null as any);
        expect(nullClient).toBeDefined();
    });

    it("handles custom base URL", () => {
        const baseUrlClient = new HttpClient({
            baseURL: 'https://api.example.com'
        });

        expect(baseUrlClient).toBeDefined();
    });

    it("handles custom user agent", () => {
        const uaClient = new HttpClient({
            userAgent: 'CustomAgent/1.0'
        });

        expect(uaClient).toBeDefined();
    });

    it("handles SSL validation disable", () => {
        const sslClient = new HttpClient({
            validateSSL: false
        });

        expect(sslClient).toBeDefined();
    });
});

describe("HttpClient Error Classification", () => {
    it("classifies 400 Bad Request", () => {
        const error = { response: { status: 400 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('badRequest');
        expect(result.retryable).toBe(false);
        expect(result.status).toBe('clientError');
    });

    it("classifies 401 Unauthorized", () => {
        const error = { response: { status: 401 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('unauthorized');
        expect(result.retryable).toBe(false);
        expect(result.isAuth).toBe(true);
        expect(result.status).toBe('authRequired');
    });

    it("classifies 403 Forbidden", () => {
        const error = { response: { status: 403 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('forbidden');
        expect(result.retryable).toBe(false);
        expect(result.isAuth).toBe(true);
        expect(result.status).toBe('authFailed');
    });

    it("classifies 404 Not Found", () => {
        const error = { response: { status: 404 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('notFound');
        expect(result.retryable).toBe(false);
        expect(result.status).toBe('clientError');
    });

    it("classifies 405 Method Not Allowed", () => {
        const error = { response: { status: 405 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('methodNotAllowed');
        expect(result.retryable).toBe(false);
        expect(result.status).toBe('clientError');
    });

    it("classifies 409 Conflict", () => {
        const error = { response: { status: 409 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('conflict');
        expect(result.retryable).toBe(false);
        expect(result.status).toBe('clientError');
    });

    it("classifies 422 Unprocessable Entity", () => {
        const error = { response: { status: 422 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('unprocessableEntity');
        expect(result.retryable).toBe(false);
        expect(result.status).toBe('clientError');
    });

    it("classifies 429 Too Many Requests", () => {
        const error = { response: { status: 429 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('tooManyRequests');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('clientError');
    });

    it("classifies 500 Internal Server Error", () => {
        const error = { response: { status: 500 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('internalServerError');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('serverError');
    });

    it("classifies 502 Bad Gateway", () => {
        const error = { response: { status: 502 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('badGateway');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('serverError');
    });

    it("classifies 503 Service Unavailable", () => {
        const error = { response: { status: 503 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('serviceUnavailable');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('serverError');
    });

    it("classifies 504 Gateway Timeout", () => {
        const error = { response: { status: 504 } };
        const result = classifyError(error as any);
        expect(result.type).toBe('gatewayTimeout');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('serverError');
    });

    it("classifies unknown 4xx errors", () => {
        const error = { response: { status: 418 } }; // I'm a teapot
        const result = classifyError(error as any);
        expect(result.type).toBe('clientError');
        expect(result.retryable).toBe(false);
        expect(result.status).toBe('clientError');
    });

    it("classifies unknown 5xx errors", () => {
        const error = { response: { status: 507 } }; // Insufficient Storage
        const result = classifyError(error as any);
        expect(result.type).toBe('serverError');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('serverError');
    });

    it("classifies ECONNREFUSED", () => {
        const error = { code: 'ECONNREFUSED' };
        const result = classifyError(error as any);
        expect(result.type).toBe('connectionFailed');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('networkError');
    });

    it("classifies EHOSTUNREACH", () => {
        const error = { code: 'EHOSTUNREACH' };
        const result = classifyError(error as any);
        expect(result.type).toBe('connectionFailed');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('networkError');
    });

    it("classifies ENOTFOUND", () => {
        const error = { code: 'ENOTFOUND' };
        const result = classifyError(error as any);
        expect(result.type).toBe('connectionFailed');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('networkError');
    });

    it("classifies ESOCKETTIMEDOUT", () => {
        const error = { code: 'ESOCKETTIMEDOUT' };
        const result = classifyError(error as any);
        expect(result.type).toBe('timeout');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('timeout');
    });

    it("classifies AbortError", () => {
        const error = { name: 'AbortError' };
        const result = classifyError(error as any);
        expect(result.type).toBe('requestCancelled');
        expect(result.retryable).toBe(false);
        expect(result.status).toBe('unknown');
    });

    it("classifies timeout by message", () => {
        const error = { message: 'Request timeout occurred' };
        const result = classifyError(error as any);
        expect(result.type).toBe('timeout');
        expect(result.retryable).toBe(true);
        expect(result.status).toBe('timeout');
    });

    it("provides error descriptions", () => {
        expect(getErrorDescription('connectionFailed')).toBe('Failed to establish a connection to the server');
        expect(getErrorDescription('timeout')).toBe('Request timed out before completing');
        expect(getErrorDescription('unauthorized')).toBe('Authentication credentials are required');
        expect(getErrorDescription('notFound')).toBe('The requested resource was not found');
        expect(getErrorDescription('internalServerError')).toBe('Server encountered an internal error');
        expect(getErrorDescription('unknown')).toBe('An unknown error occurred');
    });
});

describe("HttpClient Retry Logic", () => {
    it("calculates retry delay with exponential backoff", () => {
        expect(calculateRetryDelay(1, 1000, 30000, 0.1)).toBeGreaterThanOrEqual(1000);
        expect(calculateRetryDelay(1, 1000, 30000, 0.1)).toBeLessThanOrEqual(1100);

        expect(calculateRetryDelay(2, 1000, 30000, 0.1)).toBeGreaterThanOrEqual(2000);
        expect(calculateRetryDelay(2, 1000, 30000, 0.1)).toBeLessThanOrEqual(2200);
    });

    it("respects maximum delay limit", () => {
        // Test multiple times to account for jitter
        for (let i = 0; i < 10; i++) {
            const delay = calculateRetryDelay(10, 1000, 5000, 0.1);
            expect(delay).toBeLessThanOrEqual(5500); // Allow some jitter over the limit
        }
    });

    it("determines if error should be retried", () => {
        const retryableClassification = { retryable: true, isAuth: false };
        const nonRetryableClassification = { retryable: false, isAuth: false };
        const authErrorClassification = { retryable: true, isAuth: true };

        expect(shouldRetryError(retryableClassification)).toBe(true);
        expect(shouldRetryError(nonRetryableClassification)).toBe(false);
        expect(shouldRetryError(authErrorClassification)).toBe(false); // Auth errors never retry
    });

    it("creates retry context", () => {
        const context = createRetryContext(3, 1000, 10000, 0.1);
        expect(context.attempt).toBe(1);
        expect(context.maxAttempts).toBe(3);
        expect(context.totalDelay).toBe(0);
        expect(context.nextDelay).toBeGreaterThan(0);
    });

    it("updates retry context", () => {
        const initialContext = createRetryContext(3, 1000, 10000, 0.1);
        const error = new Error('Test error');
        const updatedContext = updateRetryContext(initialContext, error, 1000, 10000, 0.1);

        expect(updatedContext.attempt).toBe(2);
        expect(updatedContext.lastError).toBe(error);
        expect(updatedContext.totalDelay).toBe(initialContext.nextDelay);
        expect(updatedContext.nextDelay).toBeGreaterThan(initialContext.nextDelay);
    });
});
