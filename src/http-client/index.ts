/**
 * HttpClient - Resilient HTTP Client with Retry Logic
 *
 * A production-ready HTTP client that:
 * - Wraps axios with enhanced error handling and retry logic
 * - Never throws exceptions - always returns unified response format
 * - Uses exponential backoff with jitter for retries
 * - Provides human-readable error classifications
 * - Supports comprehensive logging
 * - Handles all HTTP methods consistently
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type {
    HttpClientConfig,
    RequestOptions,
    HttpClientResponse,
    HttpMethod,
    HttpClientStatus,
    RetryContext
} from './types.js';
import { HttpClientError } from '../errors.js';
import { classifyError, getErrorDescription } from './errors.js';
import { calculateRetryDelay, sleep, shouldRetryError, createRetryContext, updateRetryContext } from './retry.js';

export { HttpClientError };

/**
 * Resilient HTTP Client with automatic retry logic.
 * Use HttpClient.init(context, options) when running with init/context; constructor(config) for standalone.
 */
export class HttpClient {
    private axiosInstance: AxiosInstance;
    private config: HttpClientConfig;
    private logger: any;

    constructor(contextOrConfig: any = {}, config?: HttpClientConfig) {
        const hasContext = config !== undefined;
        const options: HttpClientConfig = hasContext ? config! : (contextOrConfig || {});
        const context = hasContext ? contextOrConfig : undefined;

        this.config = {
            ...options,
            logger: context?.logger ?? options.logger ?? console,
        };
        this.logger = this.config.logger;

        this.axiosInstance = axios.create({
            timeout: this.config.timeout,
            validateStatus: () => true,
            maxRedirects: this.config.maxRedirects,
            headers: { 'User-Agent': this.config.userAgent },
            httpsAgent: this.config.validateSSL ? undefined : { rejectUnauthorized: false } as any,
        });

        // Add response interceptor for logging (optional - only if debug enabled)
        this.axiosInstance.interceptors.response.use(
            (response) => response,
            (error) => {
                // Log network-level errors here if needed
                // (HTTP errors are handled in the request method)
                return Promise.reject(error);
            }
        );
    }

    /**
     * Static init - discovers params via getAllForModule(defs). Whatever is in options goes.
     */
    static init(context: any, options: HttpClientConfig = {}): HttpClient {
        const defs: Record<string, string> = {
            timeout: 'number default 30000',
            retryCount: 'number default 3',
            retryDelay: 'number default 1000',
            maxRetryDelay: 'number default 30000',
            retryJitter: 'number default 0.1',
            userAgent: 'string default HttpClient/v1.0',
            validateSSL: 'boolean default true',
            maxRedirects: 'number default 5',
        };
        const discovered = context?.params?.getAllForModule?.(defs) ?? {};
        const merged: HttpClientConfig = { ...discovered, ...options, logger: options.logger ?? context?.logger };
        return new HttpClient(context, merged);
    }

    /**
     * Make an HTTP request with automatic retry logic
     * Never throws - always returns HttpClientResponse
     */
    async request(
        method: HttpMethod,
        url: string,
        options: RequestOptions = {}
    ): Promise<HttpClientResponse> {
        const startTime = Date.now();

        // Merge request options with defaults
        const requestConfig: AxiosRequestConfig = {
            method,
            url,
            timeout: options.timeout ?? this.config.timeout,
            headers: {
                'User-Agent': options.userAgent ?? this.config.userAgent,
                ...options.headers
            },
            params: options.params,
            data: options.data
        };

        const retryCount = options.retryCount ?? this.config.retryCount;
        const retryDelay = options.retryDelay ?? this.config.retryDelay;

        // Initialize retry context
        let retryContext: RetryContext | null = null;
        let lastError: any = null;

        // Attempt the request with retries
        for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
            try {
                if (options.debug) {
                    this.logger.debug?.(`[HttpClient] ${method} ${url} (attempt ${attempt}/${retryCount + 1})`);
                }

                const response: AxiosResponse = await this.axiosInstance.request(requestConfig);
                const duration = Date.now() - startTime;

                // Success! Return unified response format
                const customStatus = this.mapHttpStatusToCustomStatus(response.status);

                if (options.debug) {
                    this.logger.debug?.(`[HttpClient] ${method} ${url} → ${response.status} ${customStatus} (${duration}ms)`);
                }

                return {
                    status: customStatus,
                    code: response.status,
                    headers: response.headers as Record<string, string>,
                    data: response.data,
                    duration,
                    retryCount: attempt - 1,
                    finalUrl: response.request?.res?.responseUrl || url
                };

            } catch (error: any) {
                lastError = error;
                const duration = Date.now() - startTime;

                // Classify the error
                const classification = classifyError(error);
                const errorDescription = getErrorDescription(classification.type);

                // Log the error
                if (classification.retryable && attempt <= retryCount) {
                    this.logger.warn?.(`[HttpClient] ${method} ${url} failed (${classification.type}): ${errorDescription}. Retrying in ${retryDelay}ms...`);
                } else if (!classification.retryable || attempt > retryCount) {
                    this.logger.error?.(`[HttpClient] ${method} ${url} failed (${classification.type}): ${errorDescription}`);
                }

                // Check if we should retry
                if (attempt <= retryCount && shouldRetryError(classification)) {
                    // Calculate delay and wait
                    const delay = calculateRetryDelay(
                        attempt,
                        retryDelay,
                        this.config.maxRetryDelay,
                        this.config.retryJitter
                    );

                    if (options.debug) {
                        this.logger.debug?.(`[HttpClient] Waiting ${delay}ms before retry ${attempt + 1}`);
                    }

                    await sleep(delay);
                    continue;
                }

                // No more retries or not retryable - return error response
                return {
                    status: classification.status,
                    code: error.response?.status || null,
                    error: classification.type,
                    headers: error.response?.headers || null,
                    data: error.response?.data || null,
                    duration,
                    retryCount: attempt - 1,
                    finalUrl: url
                };
            }
        }

        // This should never be reached, but just in case
        return {
            status: 'unknown',
            code: null,
            error: 'unknown',
            headers: null,
            data: null,
            duration: Date.now() - startTime,
            retryCount: retryCount,
            finalUrl: url
        };
    }

    /**
     * GET request
     */
    async get(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('GET', url, options);
    }

    /**
     * POST request
     */
    async post(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('POST', url, options);
    }

    /**
     * PUT request
     */
    async put(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('PUT', url, options);
    }

    /**
     * DELETE request
     */
    async delete(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('DELETE', url, options);
    }

    /**
     * PATCH request
     */
    async patch(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('PATCH', url, options);
    }

    /**
     * HEAD request
     */
    async head(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('HEAD', url, options);
    }

    /**
     * OPTIONS request
     */
    async options(url: string, options: RequestOptions = {}): Promise<HttpClientResponse> {
        return this.request('OPTIONS', url, options);
    }

    /**
     * Map HTTP status code to custom status
     */
    private mapHttpStatusToCustomStatus(httpStatus: number): HttpClientStatus {
        if (httpStatus >= 200 && httpStatus < 300) {
            return 'success';
        } else if (httpStatus === 401) {
            return 'authRequired';
        } else if (httpStatus === 403) {
            return 'authFailed';
        } else if (httpStatus >= 400 && httpStatus < 500) {
            return 'clientError';
        } else if (httpStatus >= 500) {
            return 'serverError';
        }
        return 'unknown';
    }

    /**
     * Get current configuration (for debugging)
     */
    getConfig(): Readonly<HttpClientConfig> {
        return { ...this.config };
    }
}
