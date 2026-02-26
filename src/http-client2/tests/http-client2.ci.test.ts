import { describe, it, expect, beforeEach, vi } from "vitest";
import { HttpClient, HttpClientError } from "../index.js";
import { classifyError, getErrorDescription } from "../errors.js";
import { calculateRetryDelay, shouldRetryError, createRetryContext, updateRetryContext } from "../retry.js";
import type { HttpClientResponse } from "../types.js";

const USE_REAL_TIMEOUTS = process.env.HTTP_CLIENT_REAL_TIMEOUTS === 'true';

/** Full config (matches defs defaults) when creating client without init() */
const FULL_CONFIG = {
    timeout: 5000,
    retryCount: 2,
    retryDelay: 1000,
    maxRetryDelay: 30000,
    retryJitter: 0.1,
    userAgent: 'HttpClient/v1.0',
};

const mockContext = {
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    params: { getAll: () => ({}) },
};

function mockResponse(init: { status?: number; headers?: Record<string, string>; data?: any; url?: string }) {
    const { status = 200, headers: hIn = {}, data = null, url } = init;
    const headers: Record<string, string> = { ...hIn };
    if (data != null && !headers['content-type']) headers['Content-Type'] = 'application/json';
    const h = new Headers(headers);
    const body = status === 204 ? null : (data != null ? JSON.stringify(data) : '');
    return new Response(body, { status, headers: h, url } as ResponseInit);
}

describe("HttpClient2 CI", () => {
    let client: HttpClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeAll(() => {
        if (!USE_REAL_TIMEOUTS) vi.useFakeTimers();
    });

    afterAll(() => {
        if (!USE_REAL_TIMEOUTS) vi.useRealTimers();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);
        const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        client = new HttpClient(
            { ...mockContext, logger },
            { ...FULL_CONFIG, timeout: 5000, retryCount: 2 }
        );
    });

    it("creates HttpClient instance with default config", () => {
        const c = new HttpClient(mockContext, FULL_CONFIG);
        expect(c).toBeDefined();
    });

    it("HttpClient.init discovers params from context.params.getAllForModule", () => {
        const ctx = {
            logger: mockContext.logger,
            params: { getAllForModule: (_mod: string, _defs: Record<string, string>) => ({ timeout: 8000, retryCount: 1 }) },
        };
        const c = HttpClient.init(ctx);
        expect(c).toBeDefined();
        const cfg = c.getConfig();
        expect(cfg.timeout).toBe(8000);
        expect(cfg.retryCount).toBe(1);
    });

    it("HttpClient.init merges discovered params with provided options (options take precedence)", () => {
        const ctx = {
            logger: mockContext.logger,
            params: { getAllForModule: () => ({ timeout: 8000, retryCount: 1 }) },
        };
        const c = HttpClient.init(ctx, { timeout: 6000 });
        const cfg = c.getConfig();
        expect(cfg.timeout).toBe(6000);
        expect(cfg.retryCount).toBe(1);
    });

    it("handles successful GET request", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 200, data: { success: true }, url: 'http://example.com' }));

        const response = await client.get('http://example.com');

        expect(response).toEqual({
            status: 'success',
            code: 200,
            headers: expect.any(Object),
            data: { success: true },
            duration: expect.any(Number),
            retryCount: 0,
            finalUrl: 'http://example.com'
        });
        expect(mockFetch).toHaveBeenCalledWith(
            'http://example.com',
            expect.objectContaining({ method: 'GET' })
        );
    });

    it("handles 404 error without retry", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 404, data: { error: 'Not found' }, url: 'http://example.com/missing' }));

        const response = await client.get('http://example.com/missing');

        expect(response).toEqual({
            status: 'clientError',
            code: 404,
            error: 'notFound',
            headers: expect.any(Object),
            data: { error: 'Not found' },
            duration: expect.any(Number),
            retryCount: 0,
            finalUrl: 'http://example.com/missing'
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("handles network error with retry", async () => {
        mockFetch
            .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }))
            .mockResolvedValueOnce(mockResponse({ status: 200, data: { success: true } }));

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            vi.advanceTimersByTime(1000);
            await vi.runOnlyPendingTimersAsync();
        }

        const response = await responsePromise;

        expect(response.status).toBe('success');
        expect(response.retryCount).toBe(1);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("gives up after max retries on network error", async () => {
        mockFetch.mockRejectedValue(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }));

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
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
            retryCount: 2,
            finalUrl: 'http://example.com'
        });
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("handles timeout error", async () => {
        mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
            return new Promise((_, reject) => {
                opts?.signal?.addEventListener?.('abort', () => {
                    reject(new DOMException('aborted', 'AbortError'));
                });
            });
        });

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            for (let i = 0; i < 3; i++) {
                vi.advanceTimersByTime(5000);
                await vi.runOnlyPendingTimersAsync();
                vi.advanceTimersByTime(1000);
                await vi.runOnlyPendingTimersAsync();
            }
        }

        const response = await responsePromise;

        expect(response.status).toBe('timeout');
        expect(response.error).toBe('timeout');
        expect(response.retryCount).toBeGreaterThan(0);
    }, 15000);

    it("supports POST method", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 201, data: { created: true } }));

        const response = await client.post('http://example.com/users', { data: { name: 'John' } });

        expect(response.status).toBe('success');
        expect(mockFetch).toHaveBeenCalledWith(
            'http://example.com/users',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ name: 'John' }),
                headers: expect.objectContaining({ 'Content-Type': 'application/json' })
            })
        );
    });

    it("supports custom headers", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 200 }));

        await client.get('http://example.com', { headers: { 'Authorization': 'Bearer token123' } });

        expect(mockFetch).toHaveBeenCalledWith(
            'http://example.com',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'Bearer token123',
                    'User-Agent': 'HttpClient/v1.0'
                })
            })
        );
    });

    it("supports query parameters", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 200 }));

        await client.get('http://example.com/search', { params: { q: 'test', limit: 10 } });

        expect(mockFetch).toHaveBeenCalledWith(
            'http://example.com/search?q=test&limit=10',
            expect.any(Object)
        );
    });

    it("maps HTTP status codes to custom statuses", async () => {
        const noRetryClient = new HttpClient(mockContext, {
            ...FULL_CONFIG,
            timeout: 5000,
            retryCount: 0,
        });
        const cases = [
            { status: 200, expected: 'success' as const },
            { status: 201, expected: 'success' as const },
            { status: 401, expected: 'authRequired' as const },
            { status: 403, expected: 'authFailed' as const },
            { status: 404, expected: 'clientError' as const },
            { status: 500, expected: 'serverError' as const }
        ];
        for (const { status, expected } of cases) {
            mockFetch.mockResolvedValueOnce(mockResponse({ status }));
            const response = await noRetryClient.get('http://example.com');
            expect(response.status).toBe(expected);
        }
    });

    it("supports PUT method", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 204 }));

        const response = await client.put('http://example.com/resource/1', { data: { name: 'Updated' } });

        expect(response.status).toBe('success');
        expect(mockFetch).toHaveBeenCalledWith(
            'http://example.com/resource/1',
            expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'Updated' }) })
        );
    });

    it("supports PATCH method", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 200, data: { updated: true } }));

        const response = await client.patch('http://example.com/resource/1', { data: { name: 'Patched' } });

        expect(response.status).toBe('success');
    });

    it("supports DELETE method", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 204 }));

        const response = await client.delete('http://example.com/resource/1');

        expect(response.status).toBe('success');
    });

    it("supports OPTIONS method", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 200 }));

        const response = await client.options('http://example.com/resource');

        expect(response.status).toBe('success');
    });

    it("supports HEAD method", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 200 }));

        const response = await client.head('http://example.com/resource');

        expect(response.status).toBe('success');
    });

    it("handles 400 Bad Request", async () => {
        mockFetch.mockResolvedValue(mockResponse({ status: 400, data: { error: 'Bad request' } }));

        const response = await client.post('http://example.com', { data: {} });

        expect(response.status).toBe('clientError');
        expect(response.error).toBe('badRequest');
        expect(response.code).toBe(400);
    });

    it("handles 429 with retry", async () => {
        let callCount = 0;
        mockFetch.mockImplementation(() => {
            callCount++;
            return Promise.resolve(
                callCount === 1
                    ? mockResponse({ status: 429, data: { error: 'Rate limited' } })
                    : mockResponse({ status: 200, data: { success: true } })
            );
        });

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            vi.advanceTimersByTime(1500);
            await vi.runOnlyPendingTimersAsync();
        }

        const response = await responsePromise;

        expect(response.status).toBe('success');
        expect(response.retryCount).toBe(1);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("handles 5xx with retry", async () => {
        mockFetch
            .mockResolvedValueOnce(mockResponse({ status: 503, data: { error: 'Unavailable' } }))
            .mockResolvedValueOnce(mockResponse({ status: 200, data: { success: true } }));

        const responsePromise = client.get('http://example.com');

        if (!USE_REAL_TIMEOUTS) {
            vi.advanceTimersByTime(1000);
            await vi.runOnlyPendingTimersAsync();
        }

        const response = await responsePromise;

        expect(response.status).toBe('success');
        expect(response.retryCount).toBe(1);
    });

    it("handles baseURL", async () => {
        const c = new HttpClient(mockContext, { ...FULL_CONFIG, baseURL: 'https://api.example.com' });
        mockFetch.mockResolvedValue(mockResponse({ status: 200 }));

        await c.get('/users');

        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('https://api.example.com'),
            expect.any(Object)
        );
    });

    it("handles null/empty context gracefully", () => {
        const c = new HttpClient({} as any, FULL_CONFIG);
        expect(c).toBeDefined();
    });

    it("handles AbortError for cancelled requests", async () => {
        vi.useRealTimers();
        mockFetch.mockImplementation(() => Promise.reject(new DOMException('cancelled', 'AbortError')));

        const response = await client.get('http://example.com');

        expect(response.status).toBe('unknown');
        expect(response.error).toBe('requestCancelled');
        if (!USE_REAL_TIMEOUTS) vi.useFakeTimers();
    });

    it("getConfig returns config", () => {
        const cfg = client.getConfig();
        expect(cfg.timeout).toBe(5000);
        expect(cfg.retryCount).toBe(2);
    });
});

describe("HttpClient2 Error Classification", () => {
    it("classifies 400 Bad Request", () => {
        const r = classifyError({ response: { status: 400 } } as any);
        expect(r.type).toBe('badRequest');
        expect(r.retryable).toBe(false);
    });

    it("classifies 401 Unauthorized", () => {
        const r = classifyError({ response: { status: 401 } } as any);
        expect(r.type).toBe('unauthorized');
        expect(r.isAuth).toBe(true);
    });

    it("classifies 403 Forbidden", () => {
        const r = classifyError({ response: { status: 403 } } as any);
        expect(r.type).toBe('forbidden');
        expect(r.isAuth).toBe(true);
    });

    it("classifies 404 Not Found", () => {
        const r = classifyError({ response: { status: 404 } } as any);
        expect(r.type).toBe('notFound');
    });

    it("classifies 405, 409, 422", () => {
        expect(classifyError({ response: { status: 405 } } as any).type).toBe('methodNotAllowed');
        expect(classifyError({ response: { status: 409 } } as any).type).toBe('conflict');
        expect(classifyError({ response: { status: 422 } } as any).type).toBe('unprocessableEntity');
    });

    it("classifies 429 Too Many Requests", () => {
        const r = classifyError({ response: { status: 429 } } as any);
        expect(r.type).toBe('tooManyRequests');
        expect(r.retryable).toBe(true);
    });

    it("classifies 5xx server errors", () => {
        expect(classifyError({ response: { status: 500 } } as any).type).toBe('internalServerError');
        expect(classifyError({ response: { status: 502 } } as any).type).toBe('badGateway');
        expect(classifyError({ response: { status: 503 } } as any).type).toBe('serviceUnavailable');
        expect(classifyError({ response: { status: 504 } } as any).type).toBe('gatewayTimeout');
    });

    it("classifies response status in default ranges", () => {
        const r4 = classifyError({ response: { status: 418 } } as any);
        expect(r4.type).toBe('clientError');
        expect(r4.status).toBe('clientError');
        const r5 = classifyError({ response: { status: 599 } } as any);
        expect(r5.type).toBe('serverError');
        expect(r5.retryable).toBe(true);
    });

    it("classifies ECONNREFUSED and other connection codes", () => {
        expect(classifyError({ code: 'ECONNREFUSED' }).type).toBe('connectionFailed');
        expect(classifyError({ code: 'ECONNRESET' }).type).toBe('connectionFailed');
        expect(classifyError({ code: 'EPIPE' }).type).toBe('connectionFailed');
        expect(classifyError({ code: 'ENOTFOUND' }).type).toBe('connectionFailed');
        expect(classifyError({ code: 'EHOSTUNREACH' }).type).toBe('connectionFailed');
        expect(classifyError({ code: 'ENETUNREACH' }).type).toBe('connectionFailed');
    });

    it("classifies timeout codes", () => {
        expect(classifyError({ code: 'ETIMEDOUT' }).type).toBe('timeout');
        expect(classifyError({ code: 'ECONNABORTED' }).type).toBe('timeout');
        expect(classifyError({ code: 'ESOCKETTIMEDOUT' }).type).toBe('timeout');
    });

    it("classifies auth codes", () => {
        expect(classifyError({ code: 'EAUTH' }).type).toBe('unauthorized');
        expect(classifyError({ code: 'EACCES' }).type).toBe('unauthorized');
    });

    it("classifies unknown code as networkError", () => {
        const r = classifyError({ code: 'ESOMETHING' });
        expect(r.type).toBe('networkError');
        expect(r.retryable).toBe(true);
    });

    it("classifies AbortError with code 20 or ABORT_ERR", () => {
        expect(classifyError({ name: 'AbortError', code: 20 }).type).toBe('requestCancelled');
        expect(classifyError({ name: 'AbortError', code: 'ABORT_ERR' }).type).toBe('requestCancelled');
    });

    it("classifies AbortError as requestCancelled when not timeout", () => {
        const r = classifyError({ name: 'AbortError' });
        expect(r.type).toBe('requestCancelled');
    });

    it("classifies AbortError as timeout when isTimeout", () => {
        const r = classifyError({ name: 'AbortError', isTimeout: true });
        expect(r.type).toBe('timeout');
    });

    it("classifies message containing timeout or aborted", () => {
        expect(classifyError({ message: 'Request timeout' }).type).toBe('timeout');
        expect(classifyError({ message: 'Connection aborted' }).type).toBe('timeout');
    });

    it("classifies unknown error", () => {
        const r = classifyError({});
        expect(r.type).toBe('unknown');
        expect(r.retryable).toBe(false);
    });

    it("provides error descriptions for all types", () => {
        expect(getErrorDescription('connectionFailed')).toContain('connection');
        expect(getErrorDescription('timeout')).toContain('timed out');
        expect(getErrorDescription('badRequest')).toContain('invalid');
        expect(getErrorDescription('unauthorized')).toContain('Authentication');
        expect(getErrorDescription('forbidden')).toContain('forbidden');
        expect(getErrorDescription('notFound')).toContain('found');
        expect(getErrorDescription('tooManyRequests')).toContain('many');
        expect(getErrorDescription('requestCancelled')).toContain('cancelled');
        expect(getErrorDescription('unknown')).toContain('unknown');
    });
});

describe("HttpClient2 Retry Logic", () => {
    it("calculates retry delay", () => {
        const d = calculateRetryDelay(1, 1000, 30000, 0.1);
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThanOrEqual(1100);
    });

    it("respects max delay", () => {
        for (let i = 0; i < 5; i++) {
            const d = calculateRetryDelay(10, 1000, 5000, 0.1);
            expect(d).toBeLessThanOrEqual(5500);
        }
    });

    it("shouldRetryError", () => {
        expect(shouldRetryError({ retryable: true, isAuth: false })).toBe(true);
        expect(shouldRetryError({ retryable: false, isAuth: false })).toBe(false);
        expect(shouldRetryError({ retryable: true, isAuth: true })).toBe(false);
    });

    it("createRetryContext", () => {
        const ctx = createRetryContext(3, 1000, 10000, 0.1);
        expect(ctx.attempt).toBe(1);
        expect(ctx.maxAttempts).toBe(3);
    });

    it("updateRetryContext", () => {
        const ctx = createRetryContext(3, 1000, 10000, 0.1);
        const updated = updateRetryContext(ctx, new Error('x'), 1000, 10000, 0.1);
        expect(updated.attempt).toBe(2);
    });
});
