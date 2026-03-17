/**
 * MockStorage - FileDatabase-based mock storage using write+customMetadata and findData
 *
 * Stores HTTP mock responses keyed by request signature.
 * Uses FileDatabase metadata APIs: write with customMetadata, findData for lookup.
 */

import { createHash } from "crypto";
import { FileDatabase, FileDatabaseError } from "../filedatabase/index.js";
import type { MockResponseData } from "./types.js";

export interface MockStorageConfig {
    /** Base path for mock files (e.g. ./mocks) */
    basePath: string;
    /** Optional logger */
    logger?: any;
}

function stableStringify(obj: any): string {
    if (obj === null) return "null";
    if (obj === undefined) return "undefined";
    if (typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function normalizeQuery(query: string): string {
    if (!query) return "";
    const params = new URLSearchParams(query);
    const sorted = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return new URLSearchParams(sorted).toString();
}

function buildCriteria(
    method: string,
    host: string,
    pathname: string,
    query: string,
    requestData?: any
): Record<string, string> {
    return {
        method: method.toUpperCase(),
        host,
        pathname: pathname || "/",
        query: normalizeQuery(query),
        requestBody: requestData != null ? stableStringify(requestData) : "",
    };
}

/**
 * Compute deterministic hash key from request criteria (for backward compatibility / display).
 * With metadata mode the primary identifier is fileName; this hash is kept for tests/external use.
 */
export function computeMockKey(
    method: string,
    host: string,
    pathname: string,
    query: string,
    requestData?: any
): string {
    const criteria = buildCriteria(method, host, pathname, query, requestData);
    const str = JSON.stringify(criteria);
    return createHash("sha256").update(str).digest("hex").slice(0, 32);
}

/**
 * Mock storage using FileDatabase write+customMetadata and findData
 */
export class MockStorage {
    private fileDb: FileDatabase;
    private logger: any;

    constructor(config: MockStorageConfig) {
        this.logger = config.logger ?? console;
        this.fileDb = new FileDatabase({
            basePath: config.basePath,
            namespace: "mocks",
            tableName: "responses",
            versioned: false,
            useMetadata: true,
            logger: this.logger,
        });
    }

    /**
     * Store a mock response.
     */
    async store(method: string, requestUrl: string, requestData: any, responseData: MockResponseData): Promise<void> {
        const url = new URL(requestUrl);
        const criteria = buildCriteria(method, url.host, url.pathname, url.search.slice(1), requestData);
        await this.fileDb.write(responseData, { customMetadata: criteria });
    }

    /**
     * Find a mock response by request criteria. Returns null if not found.
     */
    async find(method: string, host: string, pathname: string, query: string, requestData?: any): Promise<MockResponseData | null> {
        const criteria = buildCriteria(method, host, pathname, query, requestData);
        try {
            const results = await this.fileDb.findData(criteria);
            if (results.length === 0) return null;
            return results[0].data as MockResponseData;
        } catch (err) {
            if (err instanceof FileDatabaseError && /No metadata found/.test(err.message)) {
                return null;
            }
            throw err;
        }
    }

    /**
     * List all stored mock keys (opaque identifiers for remove)
     */
    async listKeys(): Promise<string[]> {
        const files = await this.fileDb.listFilenames();
        return files.sort();
    }

    /**
     * Remove a mock by key (from listKeys)
     */
    async remove(fileName: string): Promise<boolean> {
        const name = fileName.endsWith(".json") ? fileName : `${fileName}.json`;
        try {
            await this.fileDb.removeFileEntry(name);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Remove a mock by request criteria (method, host, pathname, query, requestData)
     */
    async removeByCriteria(method: string, host: string, pathname: string, query: string, requestData?: any): Promise<boolean> {
        const criteria = buildCriteria(method, host, pathname, query, requestData);
        try {
            const results = await this.fileDb.findData(criteria);
            if (results.length === 0) return false;
            await this.fileDb.removeFileEntry(results[0].fileName);
            return true;
        } catch {
            return false;
        }
    }
}
