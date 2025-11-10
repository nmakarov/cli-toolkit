/**
 * MockServer Catalog - Request/Response Matching
 *
 * Provides catalog functionality for matching HTTP requests to stored mock responses
 * using FileDatabase for response data and direct file operations for catalog entries.
 */

import { FileDatabase } from '../filedatabase/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { MockResponseEntry, MockResponseData, RequestMatchCriteria } from './types.js';
import { sanitizeRequest } from './sanitization.js';

/**
 * Catalog interface for mock response storage and retrieval
 */
export class MockCatalog {
    private fileDb: FileDatabase;
    private catalogPath: string;
    private logger: any;

    constructor(fileDb: FileDatabase, catalogPath: string, logger: any = console) {
        this.fileDb = fileDb;
        this.catalogPath = catalogPath;
        this.logger = logger;
    }

    /**
     * Store a mock response in the catalog
     */
    async storeMock(
        requestUrl: string,
        requestData: any,
        responseData: MockResponseData,
        operationId?: string,
        mockName?: string,
        sensitiveKeys: string[] = []
    ): Promise<string> {
        try {
            const url = new URL(requestUrl);

            // Sanitize request data
            const sanitized = sanitizeRequest({
                query: url.search.slice(1),
                requestData,
                headers: {},
                data: responseData.data
            }, sensitiveKeys);

            // Create catalog entry
            const entry: MockResponseEntry = {
                method: 'GET', // Will be passed from caller
                host: url.host,
                pathname: url.pathname,
                query: sanitized.query,
                timestamp: new Date().toISOString(),
                ...(sanitized.requestData !== undefined ? { requestData: sanitized.requestData } : {}),
                ...(operationId ? { operationId } : {}),
                ...(mockName ? { mockName } : {})
            };

            // Generate unique filename
            const filename = this.generateFilename(entry);
            const catalogFilePath = path.join(this.catalogPath, `${filename}.json`);
            const responseFilename = `response_${filename}.json`;

            // Store the response data first
            await this.fileDb.write(responseData, { filename: responseFilename });

            // Update catalog entry with response filename
            entry.file = responseFilename;

            // Store the catalog entry directly as a file
            await fs.mkdir(path.dirname(catalogFilePath), { recursive: true });
            await fs.writeFile(catalogFilePath, JSON.stringify(entry, null, 2), 'utf-8');

            return filename;
        } catch (error) {
            this.logger.error?.('Error storing mock:', error);
            throw error;
        }
    }

    /**
     * Find mock response for a request
     */
    async findMock(criteria: RequestMatchCriteria): Promise<MockResponseData | null> {
        try {
            // Try exact match first
            const exactMatch = await this.findExactMatch(criteria);
            if (exactMatch) {
                return exactMatch;
            }

            // Try fuzzy match (ignore some parameters)
            const fuzzyMatch = await this.findFuzzyMatch(criteria);
            if (fuzzyMatch) {
                return fuzzyMatch;
            }

            return null;
        } catch (error) {
            this.logger.error?.('Error finding mock:', error);
            return null;
        }
    }

    /**
     * Find exact match for request criteria
     */
    private async findExactMatch(criteria: RequestMatchCriteria): Promise<MockResponseData | null> {
        try {
            const entries = await this.listEntries();

            for (const entry of entries) {
                if (this.matchesCriteria(entry, criteria)) {
                    return await this.loadResponseData(entry.file);
                }
            }

            return null;
        } catch (error) {
            this.logger.error?.('Error in exact match:', error);
            return null;
        }
    }

    /**
     * Find fuzzy match for request criteria
     */
    private async findFuzzyMatch(criteria: RequestMatchCriteria): Promise<MockResponseData | null> {
        try {
            // Fuzzy matching: ignore certain query parameters
            const fuzzyCriteria = {
                ...criteria,
                query: this.stripCommonParams(criteria.query)
            };

            return this.findExactMatch(fuzzyCriteria);
        } catch (error) {
            this.logger.error?.('Error in fuzzy match:', error);
            return null;
        }
    }

    /**
     * Check if a catalog entry matches the request criteria
     */
    private matchesCriteria(entry: MockResponseEntry, criteria: RequestMatchCriteria): boolean {
        return (
            entry.method === criteria.method &&
            entry.host === criteria.host &&
            entry.pathname === criteria.pathname &&
            this.queriesMatch(entry.query, criteria.query) &&
            this.requestDataMatches(entry.requestData, criteria.requestData) &&
            (!criteria.operationId || entry.operationId === criteria.operationId)
        );
    }

    /**
     * Check if query strings match (with sanitization)
     */
    private queriesMatch(storedQuery: string, requestQuery: string): boolean {
        // For now, exact match. Could be enhanced with parameter normalization
        return storedQuery === requestQuery;
    }

    /**
     * Check if request data matches
     */
    private requestDataMatches(storedData: any, requestData: any): boolean {
        if (!storedData && !requestData) {
            return true;
        }

        if (!storedData || !requestData) {
            return false;
        }

        // Simple comparison - could be enhanced
        return JSON.stringify(storedData) === JSON.stringify(requestData);
    }

    /**
     * Load response data from file
     */
    private async loadResponseData(filename: string): Promise<MockResponseData | null> {
        try {
            const data = await this.fileDb.read({ filename });
            return data as MockResponseData;
        } catch (error) {
            this.logger.error?.('Error loading response data:', error);
            return null;
        }
    }

    /**
     * Strip common query parameters for fuzzy matching
     */
    private stripCommonParams(query: string): string {
        const commonParams = ['timestamp', 'nonce', 'cache', '_'];
        const params = new URLSearchParams(query);

        for (const param of commonParams) {
            params.delete(param);
        }

        return params.toString();
    }

    /**
     * Generate unique filename for catalog entry
     */
    private generateFilename(entry: MockResponseEntry): string {
        const timestamp = Date.now();
        const hash = this.simpleHash(`${entry.method}${entry.host}${entry.pathname}${entry.query}${entry.operationId || ''}`);
        return `mock_${timestamp}_${hash}`;
    }

    /**
     * Simple hash function for filename generation
     */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * List all catalog entries
     */
    async listEntries(): Promise<MockResponseEntry[]> {
        try {
            const entries: MockResponseEntry[] = [];

            // Read all .json files from the catalog directory
            const files = await fs.readdir(this.catalogPath).catch(() => []);
            const jsonFiles = files.filter(file => file.endsWith('.json') && !file.startsWith('response_'));

            for (const file of jsonFiles) {
                try {
                    const filePath = path.join(this.catalogPath, file);
                    const content = await fs.readFile(filePath, 'utf-8');
                    const entry = JSON.parse(content) as MockResponseEntry;
                    entries.push(entry);
                } catch (error) {
                    this.logger.warn?.(`Error reading catalog entry ${file}:`, error);
                }
            }

            return entries;
        } catch (error) {
            this.logger.error?.('Error listing catalog entries:', error);
            return [];
        }
    }

    /**
     * Remove a catalog entry and its response data
     */
    async removeEntry(filename: string): Promise<boolean> {
        try {
            const catalogFilePath = path.join(this.catalogPath, `${filename}.json`);
            const responseFilename = `response_${filename}.json`;

            // Remove catalog entry file
            try {
                await fs.unlink(catalogFilePath);
            } catch (error) {
                this.logger.warn?.(`Could not remove catalog file ${catalogFilePath}:`, error);
            }

            // Remove response data (this will need to be implemented in FileDatabase)
            // For now, just try to remove the file directly
            try {
                const responseFilePath = path.join(this.catalogPath, responseFilename);
                await fs.unlink(responseFilePath);
            } catch (error) {
                this.logger.warn?.(`Could not remove response file ${responseFilename}:`, error);
            }

            return true;
        } catch (error) {
            this.logger.error?.('Error removing entry:', error);
            return false;
        }
    }

    /**
     * Clean up orphaned files and invalid catalog entries
     */
    async maintenance(): Promise<{ cleaned: number }> {
        try {
            let cleaned = 0;

            // Get all files in the directory
            const files = await fs.readdir(this.catalogPath).catch(() => []);
            const catalogFiles = files.filter(file => file.endsWith('.json') && !file.startsWith('response_'));
            const responseFiles = files.filter(file => file.startsWith('response_'));

            // Check for catalog entries with missing response files
            for (const catalogFile of catalogFiles) {
                try {
                    const catalogPath = path.join(this.catalogPath, catalogFile);
                    const content = await fs.readFile(catalogPath, 'utf-8');
                    const entry = JSON.parse(content) as MockResponseEntry;

                    const responseFile = entry.file;
                    const responsePath = path.join(this.catalogPath, responseFile);

                    // Check if response file exists
                    try {
                        await fs.access(responsePath);
                    } catch {
                        // Response file is missing, remove catalog entry
                        await fs.unlink(catalogPath);
                        cleaned++;
                        this.logger.info?.(`Removed orphaned catalog entry: ${catalogFile}`);
                    }
                } catch (error) {
                    this.logger.warn?.(`Error processing catalog file ${catalogFile}:`, error);
                }
            }

            // Check for response files without catalog entries
            const catalogResponseFiles = catalogFiles.map(file =>
                `response_${file.replace('.json', '')}.json`
            );

            for (const responseFile of responseFiles) {
                if (!catalogResponseFiles.includes(responseFile)) {
                    // Orphaned response file
                    const responsePath = path.join(this.catalogPath, responseFile);
                    await fs.unlink(responsePath);
                    cleaned++;
                    this.logger.info?.(`Removed orphaned response file: ${responseFile}`);
                }
            }

            return { cleaned };
        } catch (error) {
            this.logger.error?.('Error during maintenance:', error);
            return { cleaned: 0 };
        }
    }
}
