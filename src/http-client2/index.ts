/**
 * HttpClient2 - Resilient HTTP Client (fetch-based, no external deps)
 *
 * Drop-in replacement for http-client. Uses native fetch instead of axios.
 * Same API: retry logic, error classification, unified response format.
 *
 * Config options (via params or constructor):
 * --useTestServer=http://localhost:3000  Use test server, pass original URL in XAXIOSOrigin header
 * --saveMock=true                        Save responses to mocksPath (requires mocksPath)
 * --useMock=true                         Use stored mocks instead of real requests (requires mocksPath)
 * --mocksPath=./mocks                    Folder for mock storage (required when saveMock or useMock)
 * --showRequest=true                     Print request details
 * --showResponse=true                    Print response details
 * --showRequestHeaders=true              Include headers in request output
 * --showResponseHeaders=true             Include headers in response output
 */

import path from 'path';
import type {
    HttpClientConfig,
    RequestOptions,
    HttpClientResponse,
    HttpMethod,
    HttpClientStatus,
} from './types.js';
import { HttpClientError, ParamError } from '../errors.js';
import { classifyError, getErrorDescription } from './errors.js';
import { calculateRetryDelay, sleep, shouldRetryError } from './retry.js';
import { MockStorage } from '../mock-server/mock-storage.js';
import type { MockResponseData } from '../mock-server/types.js';

export { HttpClientError };

function buildUrl(baseURL: string | undefined, url: string, params?: Record<string, any>): string {
    let full = url;
    if (baseURL) {
        try {
            full = new URL(url, baseURL).href;
        } catch {
            full = baseURL.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
        }
    }
    if (params && Object.keys(params).length > 0) {
        const u = new URL(full);
        for (const [k, v] of Object.entries(params)) {
            if (v != null && v !== '') u.searchParams.set(k, String(v));
        }
        full = u.href;
    }
    return full;
}

function headersToRecord(h: Headers): Record<string, string> {
    const r: Record<string, string> = {};
    h.forEach((v, k) => { r[k.toLowerCase()] = v; });
    return r;
}

async function parseBody(response: Response): Promise<any> {
    const text = await response.text();
    if (!text) return null;
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
        /* not json */
    }
    return text;
}

function mapStatusToCustom(httpStatus: number): HttpClientStatus {
    if (httpStatus >= 200 && httpStatus < 300) return 'success';
    if (httpStatus === 401) return 'authRequired';
    if (httpStatus === 403) return 'authFailed';
    if (httpStatus >= 400 && httpStatus < 500) return 'clientError';
    if (httpStatus >= 500) return 'serverError';
    return 'unknown';
}

/** Smart-format value for display: limit keys for objects, elements for arrays, chars for strings */
function formatForDisplay(
    value: any,
    maxKeys: number,
    maxArrayItems: number,
    maxChars: number
): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    if (typeof value === 'string') {
        if (value.length <= maxChars) return JSON.stringify(value);
        return JSON.stringify(value.slice(0, maxChars) + `... (+${value.length - maxChars} chars)`);
    }
    if (Array.isArray(value)) {
        const head = value.slice(0, maxArrayItems);
        const rest = value.length - maxArrayItems;
        const items = head.map((v) => formatForDisplay(v, maxKeys, maxArrayItems, maxChars));
        if (rest <= 0) return `[${items.join(', ')}]`;
        return `[${items.join(', ')}, ... +${rest} more]`;
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value);
        const shown = keys.slice(0, maxKeys);
        const rest = keys.length - maxKeys;
        const pairs = shown.map((k) => `${JSON.stringify(k)}: ${formatForDisplay(value[k], maxKeys, maxArrayItems, maxChars)}`);
        if (rest <= 0) return `{${pairs.join(', ')}}`;
        return `{${pairs.join(', ')}, ... +${rest} more keys}`;
    }
    return String(value);
}

export class HttpClient {
    private context: any;
    private config: HttpClientConfig;
    private logger: any;
    private mockStorage: MockStorage | null = null;

    constructor(context: any, options: HttpClientConfig = {}) {
        this.context = context;
        this.config = options;
        this.logger = options.logger ?? context?.logger ?? console;
        if (options.saveMock || options.useMock) {
            const mocksPath = options.mocksPath;
            if (!mocksPath) {
                throw new ParamError('[http-client2] mocksPath is required when saveMock or useMock is set');
            }
            const absoluteMocksPath = path.resolve(mocksPath);
            this.mockStorage = new MockStorage({ basePath: absoluteMocksPath, logger: this.logger });
            const mode = [options.saveMock && 'saveMock', options.useMock && 'useMock'].filter(Boolean).join(', ');
            this.logger.debug?.(`[HttpClient] mocks enabled (${mode}), mocksPath=${absoluteMocksPath}`);
        }
    }

    /**
     * Static init - discovers params via context.params.getAllForModule("http-client2", defs). Whatever is in options goes.
     */
    static init(context: any, options: HttpClientConfig = {}): HttpClient {
        const defs: Record<string, string> = {
            timeout: 'number default 30000',
            retryCount: 'number default 3',
            retryDelay: 'number default 1000',
            maxRetryDelay: 'number default 30000',
            retryJitter: 'number default 0.1',
            userAgent: 'string default HttpClient/v1.0',
            baseURL: 'string',
            saveMock: 'boolean default false',
            useMock: 'boolean default false',
            mocksPath: 'string',
            useTestServer: 'string',
            showRequest: 'boolean default false',
            showResponse: 'boolean default false',
            showRequestHeaders: 'boolean default false',
            showResponseHeaders: 'boolean default false',
            showMaxKeys: 'number default 20',
            showMaxArrayItems: 'number default 5',
            showMaxChars: 'number default 300',
        };
        const discovered = context?.params?.getAll?.(defs) ?? {};
        const merged: HttpClientConfig = { ...discovered, ...options };

        if ((merged.saveMock || merged.useMock) && !merged.mocksPath) {
            throw new ParamError('[http-client2] mocksPath is required when saveMock or useMock is set');
        }
        if ((merged.saveMock || merged.useMock) && merged.useTestServer) {
            throw new ParamError('[http-client2] saveMock/useMock cannot be used with useTestServer');
        }

        return new HttpClient(context, merged);
    }

    async request(method: HttpMethod, url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        const startTime = Date.now();
        const timeout = options.timeout ?? this.config.timeout;
        const retryCount = options.retryCount ?? this.config.retryCount ?? 3;
        const retryDelay = options.retryDelay ?? this.config.retryDelay ?? 1000;
        let fullUrl = buildUrl(this.config.baseURL, url, options.params);

        console.info("!!!!!!!!!!!!!!!!!!!!!!");


        // useMock: try to find stored mock; if not found, do not make real request
        if (this.config.useMock && this.mockStorage) {
            try {
                const urlObj = new URL(fullUrl);
                const mock = await this.mockStorage.find(
                    method,
                    urlObj.host,
                    urlObj.pathname,
                    urlObj.search.slice(1),
                    options.data
                );
                if (mock) {
                    const duration = Date.now() - startTime;
                    if (this.config.showResponse) {
                        this.logRequestResponse(method, fullUrl, options, null, mock, duration, true);
                    }
                    return {
                        status: mapStatusToCustom(mock.status),
                        code: mock.status,
                        headers: mock.headers || {},
                        data: mock.data,
                        duration,
                        retryCount: 0,
                        finalUrl: fullUrl
                    };
                }
                throw new HttpClientError(`Mock not found for ${method} ${fullUrl}`);
            } catch (e) {
                if (e instanceof HttpClientError) throw e;
                this.logger.warn?.('[HttpClient] Mock lookup failed:', e);
                throw new HttpClientError(`Mock not found for ${method} ${fullUrl} (lookup failed: ${(e as Error).message})`);
            }
        }

        // useTestServer: redirect request to test server, pass original URL in XAXIOSOrigin
        let fetchUrl = fullUrl;
        const headers: Record<string, string> = {
            'User-Agent': options.userAgent ?? this.config.userAgent ?? 'HttpClient/v1.0',
            ...options.headers
        };
        if (this.config.useTestServer) {
            const urlObj = new URL(fullUrl);
            fetchUrl = this.config.useTestServer.replace(/\/$/, '') + urlObj.pathname + urlObj.search;
            headers['XAXIOSOrigin'] = fullUrl;
        }

        let body: string | undefined;
        if (options.data != null && ['POST', 'PUT', 'PATCH'].includes(method)) {
            body = typeof options.data === 'string' ? options.data : JSON.stringify(options.data);
            if (!headers['content-type']) headers['Content-Type'] = 'application/json';
        }

        if (this.config.showRequest) {
            this.logRequestResponse(method, fullUrl, options, headers, null, 0, false);
        }

        let lastError: any = null;

        for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
            let abortedByTimeout = false;
            try {
                if (options.debug) {
                    this.logger.debug?.(`[HttpClient] ${method} ${fullUrl} (attempt ${attempt}/${retryCount + 1})`);
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    abortedByTimeout = true;
                    controller.abort();
                }, timeout);

                const response = await fetch(fetchUrl, {
                    method,
                    headers,
                    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
                    signal: controller.signal,
                    redirect: 'follow'
                });

                clearTimeout(timeoutId);

                const duration = Date.now() - startTime;
                const resHeaders = headersToRecord(response.headers);

                console.info(">> fullUrl:", fullUrl);
                console.info(">> response:", response);


                if (response.ok) {
                    const data = await parseBody(response);
                    if (options.debug) {
                        this.logger.debug?.(`[HttpClient] ${method} ${fullUrl} → ${response.status} success (${duration}ms)`);
                    }
                    const result: HttpClientResponse = {
                        status: mapStatusToCustom(response.status),
                        code: response.status,
                        headers: resHeaders,
                        data,
                        duration,
                        retryCount: attempt - 1,
                        finalUrl: response.url || fullUrl
                    };
                    if (this.config.saveMock && this.mockStorage) {
                        try {
                            const responseData: MockResponseData = {
                                status: response.status,
                                headers: resHeaders,
                                data
                            };
                            await this.mockStorage.store(
                                method,
                                fullUrl,
                                options.data,
                                responseData
                            );
                        } catch (e) {
                            this.logger.warn?.('[HttpClient] Failed to save mock:', e);
                        }
                    }
                    if (this.config.showResponse) {
                        this.logRequestResponse(method, fullUrl, options, headers, { status: response.status, headers: resHeaders, data }, duration, false);
                    }
                    return result;
                }


                const data = await parseBody(response);

                console.info(">> something is wrong with the request/response:", data);

                const classification = classifyError({ response: { status: response.status, headers: resHeaders, data } });

                if (this.config.showResponse) {
                    this.logRequestResponse(method, fullUrl, options, headers, { status: response.status, headers: resHeaders, data }, duration, false);
                }
                if (options.debug) {
                    this.logger.debug?.(`[HttpClient] ${method} ${fullUrl} → ${response.status} ${classification.status} (${duration}ms)`);
                }

                if (attempt <= retryCount && shouldRetryError(classification)) {
                    const delay = calculateRetryDelay(attempt, retryDelay, this.config.maxRetryDelay ?? 30000, this.config.retryJitter ?? 0.1);
                    this.logger.warn?.(`[HttpClient] ${method} ${fullUrl} failed (${classification.type}). Retrying in ${delay}ms...`);
                    if (options.debug) this.logger.debug?.(`[HttpClient] Waiting ${delay}ms before retry ${attempt + 1}`);
                    await sleep(delay);
                    continue;
                }

                return {
                    status: classification.status,
                    code: response.status,
                    error: classification.type,
                    headers: resHeaders,
                    data,
                    duration,
                    retryCount: attempt - 1,
                    finalUrl: response.url || fullUrl
                };

            } catch (error: any) {
                if (abortedByTimeout) {
                    lastError = { ...(error || {}), name: 'AbortError', isTimeout: true };
                } else {
                    lastError = error;
                }
                const duration = Date.now() - startTime;
                const classification = classifyError(lastError);

                if (classification.retryable && attempt <= retryCount) {
                    this.logger.warn?.(`[HttpClient] ${method} ${fullUrl} failed (${classification.type}): ${getErrorDescription(classification.type)}. Retrying...`);
                } else {
                    this.logger.error?.(`[HttpClient] ${method} ${fullUrl} failed (${classification.type}): ${getErrorDescription(classification.type)}`);
                }

                if (attempt <= retryCount && shouldRetryError(classification)) {
                    const delay = calculateRetryDelay(attempt, retryDelay, this.config.maxRetryDelay ?? 30000, this.config.retryJitter ?? 0.1);
                    if (options.debug) this.logger.debug?.(`[HttpClient] Waiting ${delay}ms before retry ${attempt + 1}`);
                    await sleep(delay);
                    continue;
                }

                return {
                    status: classification.status,
                    code: null,
                    error: classification.type,
                    headers: null,
                    data: null,
                    duration,
                    retryCount: attempt - 1,
                    finalUrl: fullUrl
                };
            }
        }

        const classification = lastError ? classifyError(lastError) : { status: 'unknown' as HttpClientStatus, type: 'unknown' as any };
        return {
            status: classification.status,
            code: null,
            error: classification.type,
            headers: null,
            data: null,
            duration: Date.now() - startTime,
            retryCount: retryCount,
            finalUrl: fullUrl
        };
    }

    private logRequestResponse(
        method: string,
        url: string,
        options: RequestOptions,
        reqHeaders: Record<string, string> | null,
        res: { status: number; headers: Record<string, string>; data: any } | null,
        durationMs: number,
        fromMock: boolean
    ): void {
        const maxKeys = this.config.showMaxKeys ?? 20;
        const maxArray = this.config.showMaxArrayItems ?? 5;
        const maxChars = this.config.showMaxChars ?? 300;
        const log = this.logger.info ?? this.logger.log ?? console.log;

        log(`[HttpClient] ${method} ${url}`);
        if (this.config.showRequestHeaders && reqHeaders && Object.keys(reqHeaders).length > 0) {
            log(`  Request headers: ${formatForDisplay(reqHeaders, maxKeys, maxArray, maxChars)}`);
        }
        if (options.data != null) {
            log(`  Request body: ${formatForDisplay(options.data, maxKeys, maxArray, maxChars)}`);
        }
        if (res) {
            log(`  → ${res.status}${fromMock ? ' (from mock)' : ''} ${durationMs}ms`);
            if (this.config.showResponseHeaders && res.headers && Object.keys(res.headers).length > 0) {
                log(`  Response headers: ${formatForDisplay(res.headers, maxKeys, maxArray, maxChars)}`);
            }
            if (res.data != null) {
                log(`  Response body: ${formatForDisplay(res.data, maxKeys, maxArray, maxChars)}`);
            }
        }
    }

    async get(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('GET', url, options);
    }

    async post(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('POST', url, options);
    }

    async put(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('PUT', url, options);
    }

    async delete(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('DELETE', url, options);
    }

    async patch(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('PATCH', url, options);
    }

    async head(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('HEAD', url, options);
    }

    async options(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('OPTIONS', url, options);
    }

    getConfig(): Readonly<HttpClientConfig> {
        return { ...this.config };
    }
}
