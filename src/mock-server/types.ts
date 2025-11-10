/**
 * MockServer Types
 *
 * Type definitions for the MockServer module - HTTP mock server with FileDatabase integration
 */

/**
 * MockServer configuration options
 */
export interface MockServerConfig {
    /** Port to listen on (default: 5029) */
    port?: number;
    /** Base path for mock data storage (required) */
    basePath: string;
    /** Namespace for mock data (default: "mocks") */
    namespace?: string;
    /** Table name for mock data (default: "responses") */
    tableName?: string;
    /** Sensitive parameter keys to mask (default: common auth keys) */
    sensitiveKeys?: string[];
    /** Logger instance */
    logger?: any;
    /** Whether to enable debug logging (default: false) */
    debug?: boolean;
    /** Custom middleware functions to add to Express app */
    middleware?: Array<(req: any, res: any, next: any) => void>;
    /** Optional FileDatabase instance (for testing) */
    fileDb?: any;
}

/**
 * Mock response entry stored in FileDatabase
 */
export interface MockResponseEntry {
    /** HTTP method (GET, POST, etc.) */
    method: string;
    /** Original host from request */
    host: string;
    /** URL pathname */
    pathname: string;
    /** Sanitized query string */
    query: string;
    /** Response filename */
    file: string;
    /** Timestamp when mock was created */
    timestamp: string;
    /** Sanitized request data (if any) */
    requestData?: string | object;
    /** Optional operation ID for precise matching */
    operationId?: string;
    /** Optional mock name for identification */
    mockName?: string;
}

/**
 * Mock response data structure
 */
export interface MockResponseData {
    /** HTTP status code */
    status: number;
    /** Response headers */
    headers: Record<string, string>;
    /** Response data */
    data: any;
}

/**
 * Request matching criteria
 */
export interface RequestMatchCriteria {
    /** HTTP method */
    method: string;
    /** Original host */
    host: string;
    /** URL pathname */
    pathname: string;
    /** Query string (can be sanitized or raw) */
    query: string;
    /** Request data (can be sanitized or raw) */
    requestData?: string | object;
    /** Optional operation ID */
    operationId?: string;
}

/**
 * Request sanitization result
 */
export interface SanitizedRequest {
    /** Sanitized query string */
    query: string;
    /** Sanitized request data */
    requestData?: string | object;
    /** Sanitized headers */
    headers: Record<string, string>;
    /** Sanitized response data (for storage) */
    data: any;
}

/**
 * Server instance returned by MockServer
 */
export interface MockServerInstance {
    /** Express server instance */
    server: any;
    /** Port the server is listening on */
    port: number;
    /** Close the server */
    close: () => Promise<void>;
    /** Get server statistics */
    getStats: () => ServerStats;
}

/**
 * Server statistics
 */
export interface ServerStats {
    /** Total requests handled */
    totalRequests: number;
    /** Mock responses served */
    mockResponses: number;
    /** Fallback responses served */
    fallbackResponses: number;
    /** Errors encountered */
    errors: number;
    /** Uptime in milliseconds */
    uptime: number;
}

/**
 * Maintenance operation result
 */
export interface MaintenanceResult {
    /** Orphaned files removed */
    filesRemoved: number;
    /** Catalogue entries cleaned */
    catalogueEntriesRemoved: number;
    /** Total size cleaned (bytes) */
    sizeCleaned: number;
}
