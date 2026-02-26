/**
 * HttpClient2 - Resilient HTTP Client (fetch-based, no external deps)
 *
 * Drop-in replacement for http-client. Uses native fetch instead of axios.
 * Same API: retry logic, error classification, unified response format.
 */

import type {
    HttpClientConfig,
    RequestOptions,
    HttpClientResponse,
    HttpMethod,
    HttpClientStatus,
} from './types.js';
import { HttpClientError } from '../errors.js';
import { classifyError, getErrorDescription } from './errors.js';
import { calculateRetryDelay, sleep, shouldRetryError } from './retry.js';

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

export class HttpClient {
    private context: any;
    private config: HttpClientConfig;
    private logger: any;

    constructor(context: any, options: HttpClientConfig = {}) {
        this.context = context;
        this.config = options;
        this.logger = options.logger ?? context?.logger ?? console;
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
        };
        const discovered = context?.params?.getAllForModule?.(defs) ?? {};
        const merged: HttpClientConfig = { ...discovered, ...options };
        return new HttpClient(context, merged);
    }

    async request(method: HttpMethod, url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        const startTime = Date.now();
        const timeout = options.timeout ?? this.config.timeout;
        const retryCount = options.retryCount ?? this.config.retryCount;
        const retryDelay = options.retryDelay ?? this.config.retryDelay;
        const fullUrl = buildUrl(this.config.baseURL, url, options.params);

        const headers: Record<string, string> = {
            'User-Agent': options.userAgent ?? this.config.userAgent,
            ...options.headers
        };

        let body: string | undefined;
        if (options.data != null && ['POST', 'PUT', 'PATCH'].includes(method)) {
            body = typeof options.data === 'string' ? options.data : JSON.stringify(options.data);
            if (!headers['content-type']) headers['Content-Type'] = 'application/json';
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

                const response = await fetch(fullUrl, {
                    method,
                    headers,
                    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
                    signal: controller.signal,
                    redirect: 'follow'
                });

                clearTimeout(timeoutId);

                const duration = Date.now() - startTime;
                const resHeaders = headersToRecord(response.headers);

                if (response.ok) {
                    const data = await parseBody(response);
                    if (options.debug) {
                        this.logger.debug?.(`[HttpClient] ${method} ${fullUrl} → ${response.status} success (${duration}ms)`);
                    }
                    return {
                        status: mapStatusToCustom(response.status),
                        code: response.status,
                        headers: resHeaders,
                        data,
                        duration,
                        retryCount: attempt - 1,
                        finalUrl: response.url || fullUrl
                    };
                }

                const data = await parseBody(response);
                const classification = classifyError({ response: { status: response.status, headers: resHeaders, data } });

                if (options.debug) {
                    this.logger.debug?.(`[HttpClient] ${method} ${fullUrl} → ${response.status} ${classification.status} (${duration}ms)`);
                }

                if (attempt <= retryCount && shouldRetryError(classification)) {
                    const delay = calculateRetryDelay(attempt, retryDelay, this.config.maxRetryDelay, this.config.retryJitter);
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
                    const delay = calculateRetryDelay(attempt, retryDelay, this.config.maxRetryDelay, this.config.retryJitter);
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
