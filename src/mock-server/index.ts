/**
 * MockServer - HTTP Mock Server with FileDatabase Integration
 *
 * A complete HTTP mock server that captures and serves API responses using FileDatabase
 * for persistent storage and retrieval. Replaces the legacy MockEngine with modern,
 * type-safe implementation.
 */

import express from 'express';
import http from 'http';
import morgan from 'morgan';
import { FileDatabase } from '../filedatabase/index.js';
import { MockCatalog } from './catalog.js';
import type {
    MockServerConfig,
    MockServerInstance,
    MockResponseEntry,
    MockResponseData,
    RequestMatchCriteria,
    ServerStats,
    MaintenanceResult
} from './types.js';
import { sanitizeRequest } from './sanitization.js';

/**
 * Default sensitive keys to mask in requests/responses
 */
const DEFAULT_SENSITIVE_KEYS = [
    'client_id',
    'client_secret',
    'access_token',
    'authorization',
    'bearer',
    'api_key',
    'apikey',
    'password',
    'token'
];

/**
 * HTTP Mock Server with FileDatabase integration
 */
export class MockServer {
    private config: Required<MockServerConfig>;
    private app: express.Application;
    private server: http.Server | null = null;
    private fileDb: FileDatabase;
    private catalog: MockCatalog;
    private stats: ServerStats;
    private startTime: number;

    constructor(config: MockServerConfig) {
        this.config = {
            port: 5029,
            namespace: 'mocks',
            tableName: 'responses',
            sensitiveKeys: DEFAULT_SENSITIVE_KEYS,
            logger: console,
            debug: false,
            middleware: [],
            ...config
        };

        if (!this.config.basePath) {
            throw new Error('MockServer: basePath is required');
        }

        this.app = express();
        this.startTime = Date.now();
        this.stats = {
            totalRequests: 0,
            mockResponses: 0,
            fallbackResponses: 0,
            errors: 0,
            uptime: 0
        };

        this.fileDb = this.config.fileDb || new FileDatabase({
            basePath: this.config.basePath,
            namespace: this.config.namespace,
            tableName: this.config.tableName,
            versioned: false, // Mock responses are typically not versioned
            logger: this.config.logger
        });

        this.catalog = new MockCatalog(this.fileDb, this.config.basePath, this.config.logger);

        this.setupMiddleware();
        this.setupRoutes();
    }

    /**
     * Start the mock server
     */
    async start(): Promise<MockServerInstance> {
        return new Promise((resolve, reject) => {
            try {
                this.server = http.createServer(this.app);

                this.server.listen(this.config.port, () => {
                    this.config.logger.info?.(`MockServer listening on port ${this.config.port}`);
                    resolve({
                        server: this.server!,
                        port: this.config.port,
                        close: () => this.stop(),
                        getStats: () => this.getCurrentStats()
                    });
                });

                this.server.on('error', (error) => {
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Stop the mock server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.config.logger.info?.('MockServer stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Get current server statistics (internal)
     */
    private getCurrentStats(): ServerStats {
        return {
            ...this.stats,
            uptime: Date.now() - this.startTime
        };
    }

    /**
     * Setup Express middleware
     */
    private setupMiddleware(): void {
        // Body parsing
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.json());

        // Logging with decoded URLs
        morgan.token('urlDecoded', (req) => {
            return decodeURIComponent(req.url || '');
        });

        this.app.use(morgan(':method :urlDecoded :status :response-time', {
            skip: (req, res) => req.url === '/version' || res.statusCode === 429,
            stream: {
                write: (message) => {
                    if (this.config.debug) {
                        this.config.logger.debug?.(message.trim());
                    }
                }
            }
        }));

        // Custom middleware
        for (const middleware of this.config.middleware) {
            this.app.use(middleware);
        }
    }

    /**
     * Setup API routes
     */
    private setupRoutes(): void {
        // Version endpoint
        this.app.get('/version', (req, res) => {
            res.json({ version: '1.0.0', server: 'MockServer' });
        });

        // 404 test endpoint
        this.app.get('/404', (req, res) => {
            res.status(404).json({ code: 'not_found', message: 'not found' });
        });

        // Test endpoint with delay and error simulation
        this.app.get('/test', async (req, res) => {
            const delay = req.get('x-axios-delay');
            const err = req.get('x-axios-err');

            // Handle delay
            if (delay) {
                await new Promise(resolve => setTimeout(resolve, parseInt(delay)));
            }

            // Handle simulated errors
            if (err) {
                if (!isNaN(Number(err))) {
                    return res.status(Number(err)).json({
                        code: 'error',
                        message: `expected error ${err}`
                    });
                }

                if (err === 'econnreset') {
                    const connection = (req as any).connection || (req as any).socket;
                    connection?.destroy();
                    return;
                }
            }

            // Success response
            const message = delay ? `success with delay ${delay}` : 'success';
            res.status(200).json({ code: 'success', message });
        });

        // Catch-all route for mock responses
        this.app.all('/*', async (req, res) => {
            this.stats.totalRequests++;

            try {
                const mockResponse = await this.findMockResponse(req);

                if (mockResponse) {
                    this.stats.mockResponses++;

                    // Remove problematic headers
                    const safeHeaders = { ...mockResponse.headers };
                    delete safeHeaders['transfer-encoding'];
                    delete safeHeaders['Transfer-Encoding'];

                    res.set(safeHeaders);
                    res.status(mockResponse.status).send(mockResponse.data);
                } else {
                    this.stats.fallbackResponses++;
                    res.status(200).json({ code: 'ok', message: 'catch all' });
                }
            } catch (error) {
                this.stats.errors++;
                this.config.logger.error?.('MockServer error:', error);
                res.status(500).json({ code: 'server_error', message: 'Internal server error' });
            }
        });
    }

    /**
     * Find mock response for a request
     */
    private async findMockResponse(req: express.Request): Promise<MockResponseData | null> {
        const headerValue = req.get('XAXIOSOrigin');

        if (!headerValue) {
            return null;
        }

        try {
            const url = new URL(headerValue);
            const method = req.method;
            const pathname = url.pathname;
            const query = url.search.slice(1); // Remove leading ?
            const requestData = this.extractRequestData(req);

            const criteria: RequestMatchCriteria = {
                method,
                host: url.host,
                pathname,
                query,
                requestData
            };

            return await this.catalog.findMock(criteria);
        } catch (error) {
            this.config.logger.error?.('Error finding mock response:', error);
            return null;
        }
    }


    /**
     * Extract request data from Express request
     */
    private extractRequestData(req: express.Request): any {
        const contentType = req.get('content-type');

        if (contentType?.includes('application/x-www-form-urlencoded')) {
            return req.body; // Already parsed by express.urlencoded
        } else if (contentType?.includes('application/json')) {
            return req.body; // Already parsed by express.json
        }

        return req.body;
    }

    /**
     * Store a mock response from an HTTP request/response
     */
    async storeMock(
        requestUrl: string,
        requestData: any,
        responseData: MockResponseData,
        operationId?: string,
        mockName?: string
    ): Promise<string> {
        return await this.catalog.storeMock(
            requestUrl,
            requestData,
            responseData,
            operationId,
            mockName,
            this.config.sensitiveKeys
        );
    }

    /**
     * List all stored mock responses
     */
    async listMocks(): Promise<MockResponseEntry[]> {
        return await this.catalog.listEntries();
    }

    /**
     * Remove a mock response by filename
     */
    async removeMock(filename: string): Promise<boolean> {
        return await this.catalog.removeEntry(filename);
    }

    /**
     * Run maintenance to clean up orphaned files
     */
    async maintenance(): Promise<{ cleaned: number }> {
        return await this.catalog.maintenance();
    }

    /**
     * Get current configuration
     */
    getConfig(): Readonly<MockServerConfig> {
        return { ...this.config };
    }

    /**
     * Get server statistics
     */
    getStats(): ServerStats {
        return {
            ...this.stats,
            uptime: Date.now() - this.startTime
        };
    }
}

/**
 * Create and start a mock server instance
 */
export async function createMockServer(config: MockServerConfig): Promise<MockServerInstance> {
    const server = new MockServer(config);
    return server.start();
}
