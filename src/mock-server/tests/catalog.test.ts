import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockCatalog } from "../catalog";
import type { MockResponseData, RequestMatchCriteria } from "../types";

// Import modules first
import * as fs from 'fs/promises';
import * as path from 'path';

// Then mock them to avoid hoisting issues
vi.mock('fs/promises');
vi.mock('path');

describe("MockCatalog", () => {
    let catalog: MockCatalog;
    let mockFileDb: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create a mock FileDatabase instance
        mockFileDb = {
            write: vi.fn(),
            read: vi.fn(),
            hasData: vi.fn(),
            getLatestVersion: vi.fn(),
            getVersions: vi.fn()
        };

        // Setup fs and path mocks
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);
        vi.mocked(fs.writeFile).mockResolvedValue(undefined);
        vi.mocked(fs.readFile).mockResolvedValue('[]');
        vi.mocked(fs.readdir).mockResolvedValue([]);
        vi.mocked(fs.unlink).mockResolvedValue(undefined);
        vi.mocked(fs.access).mockResolvedValue(undefined);
        vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
        vi.mocked(path.dirname).mockImplementation((p) => p.split('/').slice(0, -1).join('/'));

        catalog = new MockCatalog(mockFileDb, '/test-path', console);
    });

    describe("storeMock", () => {
        it("should store mock response successfully", async () => {
            const responseData: MockResponseData = {
                status: 200,
                headers: { 'content-type': 'application/json' },
                data: { id: 1, name: 'test' }
            };

            mockFileDb.write.mockResolvedValue(undefined);

            const filename = await catalog.storeMock(
                'https://api.example.com/users/1',
                { userId: 123 },
                responseData,
                'getUser',
                'Get User Profile'
            );

            expect(filename).toMatch(/^mock_\d+_[a-z0-9]+$/);
            expect(mockFileDb.write).toHaveBeenCalledTimes(1); // Only response data (catalog uses direct fs.writeFile)
            expect(vi.mocked(fs.writeFile)).toHaveBeenCalledTimes(1); // Catalog entry
        });

        it("should handle different HTTP methods", async () => {
            // This test would need to modify the catalog to accept method parameter
            // Currently hardcoded to GET, but should be enhanced
            const responseData: MockResponseData = {
                status: 201,
                headers: {},
                data: { created: true }
            };

            mockFileDb.write.mockResolvedValue(undefined);
            (fs.mkdir as any).mockResolvedValue(undefined);
            (fs.writeFile as any).mockResolvedValue(undefined);

            await catalog.storeMock(
                'https://api.example.com/users',
                { name: 'John' },
                responseData
            );

            expect(mockFileDb.write).toHaveBeenCalled();
        });

        it("should sanitize sensitive data", async () => {
            const responseData: MockResponseData = {
                status: 200,
                headers: { 'authorization': 'Bearer token123' },
                data: { api_key: 'secret123', user: 'john' }
            };

            mockFileDb.write.mockResolvedValue(undefined);

            await catalog.storeMock(
                'https://api.example.com/secure',
                { client_id: 'client123', password: 'pass123' },
                responseData,
                undefined,
                undefined,
                ['client_id', 'password', 'authorization', 'api_key']
            );

            // Check that sensitive data was sanitized in the catalog entry
            const writeFileCall = vi.mocked(fs.writeFile).mock.calls[0];
            const storedData = JSON.parse(writeFileCall[1]);

            expect(storedData.requestData).toHaveProperty('client_id');
            expect(storedData.requestData.client_id).toContain('[md5:');
        });

        it("should handle storage errors", async () => {
            const responseData: MockResponseData = {
                status: 200,
                headers: {},
                data: { error: true }
            };

            mockFileDb.write.mockRejectedValue(new Error('Storage error'));

            await expect(catalog.storeMock(
                'https://api.example.com/test',
                null,
                responseData
            )).rejects.toThrow('Storage error');
        });
    });

    describe("findMock", () => {
        it("should find exact match", async () => {
            const criteria: RequestMatchCriteria = {
                method: 'GET',
                host: 'api.example.com',
                pathname: '/users/1',
                query: 'format=json'
            };

            const mockEntries = [{
                method: 'GET',
                host: 'api.example.com',
                pathname: '/users/1',
                query: 'format=json',
                file: 'response_test.json',
                timestamp: new Date().toISOString()
            }];

            const responseData = {
                status: 200,
                headers: { 'content-type': 'application/json' },
                data: { id: 1, name: 'test' }
            };

            (fs.readdir as any).mockResolvedValue(['test.json']);
            (fs.readFile as any).mockResolvedValue(JSON.stringify(mockEntries[0]));
            mockFileDb.read.mockResolvedValue(responseData);

            const result = await catalog.findMock(criteria);
            expect(result).toEqual(responseData);
        });

        it("should return null when no match found", async () => {
            const criteria: RequestMatchCriteria = {
                method: 'GET',
                host: 'api.example.com',
                pathname: '/users/999',
                query: ''
            };

            (fs.readdir as any).mockResolvedValue([]);

            const result = await catalog.findMock(criteria);
            expect(result).toBeNull();
        });

        it("should perform fuzzy matching when exact match fails", async () => {
            const criteria: RequestMatchCriteria = {
                method: 'GET',
                host: 'api.example.com',
                pathname: '/users/1',
                query: 'format=json&timestamp=123456'
            };

            const mockEntries = [{
                method: 'GET',
                host: 'api.example.com',
                pathname: '/users/1',
                query: 'format=json', // Without timestamp
                file: 'response_test.json',
                timestamp: new Date().toISOString()
            }];

            const responseData = {
                status: 200,
                headers: {},
                data: { id: 1 }
            };

            (fs.readdir as any).mockResolvedValue(['test.json']);
            (fs.readFile as any).mockResolvedValue(JSON.stringify(mockEntries[0]));
            mockFileDb.read.mockResolvedValue(responseData);

            const result = await catalog.findMock(criteria);
            expect(result).toEqual(responseData);
        });

        it("should match by operation ID", async () => {
            const criteria: RequestMatchCriteria = {
                method: 'GET',
                host: 'api.example.com',
                pathname: '/users/1',
                query: '',
                operationId: 'getUser'
            };

            const mockEntries = [{
                method: 'GET',
                host: 'api.example.com',
                pathname: '/users/1',
                query: '',
                file: 'response_test.json',
                timestamp: new Date().toISOString(),
                operationId: 'getUser'
            }];

            const responseData = { status: 200, headers: {}, data: {} };

            (fs.readdir as any).mockResolvedValue(['test.json']);
            (fs.readFile as any).mockResolvedValue(JSON.stringify(mockEntries[0]));
            mockFileDb.read.mockResolvedValue(responseData);

            const result = await catalog.findMock(criteria);
            expect(result).toEqual(responseData);
        });
    });

    describe("listEntries", () => {
        it("should list all catalog entries", async () => {
            const mockEntries = [
                {
                    method: 'GET',
                    host: 'api.example.com',
                    pathname: '/users',
                    query: '',
                    file: 'response_1.json',
                    timestamp: new Date().toISOString(),
                    mockName: 'List Users'
                },
                {
                    method: 'POST',
                    host: 'api.example.com',
                    pathname: '/users',
                    query: '',
                    file: 'response_2.json',
                    timestamp: new Date().toISOString(),
                    mockName: 'Create User'
                }
            ];

            (fs.readdir as any).mockResolvedValue(['entry1.json', 'entry2.json', 'response_1.json']);
            (fs.readFile as any)
                .mockResolvedValueOnce(JSON.stringify(mockEntries[0]))
                .mockResolvedValueOnce(JSON.stringify(mockEntries[1]));

            const entries = await catalog.listEntries();
            expect(entries).toHaveLength(2);
            expect(entries[0].mockName).toBe('List Users');
            expect(entries[1].mockName).toBe('Create User');
        });

        it("should handle empty directory", async () => {
            (fs.readdir as any).mockResolvedValue([]);

            const entries = await catalog.listEntries();
            expect(entries).toHaveLength(0);
        });

        it("should handle read errors gracefully", async () => {
            (fs.readdir as any).mockResolvedValue(['entry1.json', 'invalid.json']);
            (fs.readFile as any)
                .mockRejectedValueOnce(new Error('Read error'))
                .mockResolvedValueOnce('invalid json');

            const entries = await catalog.listEntries();
            expect(entries).toHaveLength(0); // Both should fail, so empty array
        });
    });

    describe("removeEntry", () => {
        it("should remove catalog entry and response file", async () => {
            (fs.unlink as any).mockResolvedValue(undefined);

            const result = await catalog.removeEntry('test_entry');
            expect(result).toBe(true);
            expect(fs.unlink).toHaveBeenCalledTimes(2); // Catalog + response file
        });

        it("should handle missing files gracefully", async () => {
            (fs.unlink as any).mockRejectedValue(new Error('File not found'));

            const result = await catalog.removeEntry('missing_entry');
            expect(result).toBe(true); // Still returns true as operation was attempted
        });

        it("should handle unlink errors gracefully", async () => {
            vi.mocked(fs.unlink).mockRejectedValue(new Error('Permission denied'));

            const result = await catalog.removeEntry('protected_entry');
            expect(result).toBe(true); // Still returns true, just logs warnings
        });
    });

    describe("maintenance", () => {
        it("should clean up orphaned catalog entries", async () => {
            const mockEntry = {
                method: 'GET',
                host: 'api.example.com',
                pathname: '/test',
                query: '',
                file: 'response_missing.json',
                timestamp: new Date().toISOString()
            };

            (fs.readdir as any).mockResolvedValue(['entry1.json', 'response_existing.json']);
            (fs.readFile as any).mockResolvedValue(JSON.stringify(mockEntry));
            (fs.access as any).mockRejectedValue(new Error('File not found')); // Missing response file
            (fs.unlink as any).mockResolvedValue(undefined);

            const result = await catalog.maintenance();
            expect(result.cleaned).toBe(2); // One orphaned catalog entry + one orphaned response file
            expect(vi.mocked(fs.unlink)).toHaveBeenCalledWith('/test-path/entry1.json');
            expect(vi.mocked(fs.unlink)).toHaveBeenCalledWith('/test-path/response_existing.json');
        });

        it("should clean up orphaned response files", async () => {
            (fs.readdir as any).mockResolvedValue(['entry1.json', 'response_orphan.json']);
            (fs.readFile as any).mockResolvedValue(JSON.stringify({
                file: 'response_entry1.json'
            }));
            (fs.access as any).mockResolvedValue(undefined); // Response file exists
            (fs.unlink as any).mockResolvedValue(undefined);

            const result = await catalog.maintenance();
            expect(result.cleaned).toBe(1);
            expect(fs.unlink).toHaveBeenCalledWith('/test-path/response_orphan.json');
        });

        it("should handle maintenance errors", async () => {
            (fs.readdir as any).mockRejectedValue(new Error('Directory read error'));

            const result = await catalog.maintenance();
            expect(result.cleaned).toBe(0);
        });
    });
});
