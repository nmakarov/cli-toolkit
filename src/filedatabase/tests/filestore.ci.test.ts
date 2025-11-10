import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileDatabase, FileDatabaseError } from "../index.js";
import { ParamError } from "../../errors.js";
import fs from "fs";
import path from "path";

describe("FileDatabase CI", () => {
    const testBasePath = path.resolve(__dirname, "../../..", "test-data-filedatabase");
    
    // Clean up test directory after each test
    afterEach(async () => {
        if (fs.existsSync(testBasePath)) {
            await fs.promises.rm(testBasePath, { recursive: true, force: true });
        }
    });

    it("throws ParamError when basePath is missing", () => {
        expect(() => new FileDatabase({} as any)).toThrow(ParamError);
        expect(() => new FileDatabase({} as any)).toThrow("basePath is required");
    });

    it("creates FileDatabase instance with minimal config", () => {
        const store = new FileDatabase({ basePath: testBasePath });
        expect(store).toBeDefined();
        expect(store.getCurrentVersion()).toBeNull();
    });

    it("writes and reads JSON array data with versioning", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "test-table",
            pageSize: 100,
        });

        const testData = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }));

        await store.write(testData);

        const version = store.getCurrentVersion();
        expect(version).toBeTruthy();
        expect(version).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

        const readData = await store.read();
        expect(readData).toEqual(testData);
        expect(readData).toHaveLength(50);
    });

    it("handles chunked file writes for large datasets", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "large-data",
            pageSize: 100, // Small page size to test chunking
        });

        // Create 250 records (should split into 3 files: 100, 100, 50)
        const testData = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, value: `Value ${i + 1}` }));

        await store.write(testData);

        const metadata = store.getMetadata();
        expect(metadata.files).toHaveLength(3);
        expect(metadata.files[0].recordsCount).toBe(100);
        expect(metadata.files[1].recordsCount).toBe(100);
        expect(metadata.files[2].recordsCount).toBe(50);
        expect(metadata.totalRecords).toBe(250);

        const readData = await store.read();
        expect(readData).toHaveLength(250);
        expect(readData[0]).toEqual({ id: 1, value: "Value 1" });
        expect(readData[249]).toEqual({ id: 250, value: "Value 250" });
    });

    it("supports pagination when reading data", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "paginated",
            pageSize: 1000,
        });

        const testData = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
        await store.write(testData);

        // Read first page (100 records)
        const page1 = await store.read({ nextPage: false, pageSize: 100 });
        expect(page1).toHaveLength(100);
        expect(page1[0]).toEqual({ id: 1 });
        expect(page1[99]).toEqual({ id: 100 });

        // Read next page
        const page2 = await store.read({ nextPage: true, pageSize: 100 });
        expect(page2).toHaveLength(100);
        expect(page2[0]).toEqual({ id: 101 });
        expect(page2[99]).toEqual({ id: 200 });

        // Reset pagination
        store.resetPagination();
        const allData = await store.read();
        expect(allData).toHaveLength(500);
    });

    it("creates and manages multiple versions", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "versioned",
            maxVersions: 3,
        });

        // Write version 1
        await store.write([{ id: 1, version: 1 }]);
        const v1 = store.getCurrentVersion();

        // Write version 2 (force new version)
        await store.write([{ id: 2, version: 2 }], { forceNewVersion: true });
        const v2 = store.getCurrentVersion();

        // Write version 3
        await store.write([{ id: 3, version: 3 }], { forceNewVersion: true });
        const v3 = store.getCurrentVersion();

        expect(v1).not.toBe(v2);
        expect(v2).not.toBe(v3);

        const versions = await store.getVersions();
        expect(versions).toHaveLength(3);
        expect(versions).toContain(v1!);
        expect(versions).toContain(v2!);
        expect(versions).toContain(v3!);

        // Read from specific version
        const dataV1 = await store.read({ version: v1! });
        expect(dataV1).toEqual([{ id: 1, version: 1 }]);

        const dataV2 = await store.read({ version: v2! });
        expect(dataV2).toEqual([{ id: 2, version: 2 }]);
    });

    it("rotates old versions when maxVersions is exceeded", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "rotation",
            maxVersions: 2,
        });

        // Create 3 versions
        await store.write([{ v: 1 }]);
        const v1 = store.getCurrentVersion();

        await store.write([{ v: 2 }], { forceNewVersion: true });
        const v2 = store.getCurrentVersion();

        await store.write([{ v: 3 }], { forceNewVersion: true });
        const v3 = store.getCurrentVersion();

        const versions = await store.getVersions();
        expect(versions).toHaveLength(2); // maxVersions = 2
        expect(versions).not.toContain(v1!); // v1 should be deleted
        expect(versions).toContain(v2!);
        expect(versions).toContain(v3!);
    });

    it("writes and reads non-array data (JSON object)", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "object-data",
        });

        const testData = { name: "Test Object", value: 42, nested: { key: "value" } };
        await store.write(testData);

        const readData = await store.read();
        expect(readData).toEqual(testData);

        const metadata = store.getMetadata();
        expect(metadata.dataType).toBe("json-object");
        expect(metadata.totalRecords).toBe(1);
    });

    it("writes and reads text data", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "text-data",
        });

        const testData = "This is a plain text file.\nWith multiple lines.\nAnd some content.";
        await store.write(testData);

        const readData = await store.read();
        expect(readData).toBe(testData);

        const metadata = store.getMetadata();
        expect(metadata.dataType).toBe("text");
    });

    it("creates metadata.json when useMetadata is true", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "with-metadata",
            useMetadata: true,
        });

        const testData = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
        await store.write(testData);

        const version = store.getCurrentVersion();
        const metadataPath = path.join(testBasePath, "test-namespace", "with-metadata", version!, "metadata.json");

        expect(fs.existsSync(metadataPath)).toBe(true);

        const metadataContent = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        expect(metadataContent.version).toBe(version);
        expect(metadataContent.totalRecords).toBe(10);
        expect(metadataContent.files).toHaveLength(1);
        expect(metadataContent.dataType).toBe("json-array");
    });

    it("works without metadata.json when useMetadata is false", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "no-metadata",
            useMetadata: false,
        });

        const testData = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
        await store.write(testData);

        const version = store.getCurrentVersion();
        const metadataPath = path.join(testBasePath, "test-namespace", "no-metadata", version!, "metadata.json");

        expect(fs.existsSync(metadataPath)).toBe(false);

        // Should still be able to read data by scanning files
        const readData = await store.read();
        expect(readData).toEqual(testData);
    });

    it("supports custom file synopsis function", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "synopsis",
            pageSize: 50,
        });

        // Set synopsis function to track min/max IDs
        store.setFileSynopsisFunction((fileEntry, data) => {
            if (Array.isArray(data) && data.length > 0) {
                const ids = data.map((item: any) => item.id);
                return {
                    ...fileEntry,
                    minId: Math.min(...ids),
                    maxId: Math.max(...ids),
                };
            }
            return fileEntry;
        });

        const testData = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }));
        await store.write(testData);

        const metadata = store.getMetadata();
        expect(metadata.files).toHaveLength(3); // 50, 50, 20

        expect(metadata.files[0]).toHaveProperty("minId", 1);
        expect(metadata.files[0]).toHaveProperty("maxId", 50);

        expect(metadata.files[1]).toHaveProperty("minId", 51);
        expect(metadata.files[1]).toHaveProperty("maxId", 100);

        expect(metadata.files[2]).toHaveProperty("minId", 101);
        expect(metadata.files[2]).toHaveProperty("maxId", 120);
    });

    it("supports custom version synopsis function", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "version-synopsis",
        });

        store.setVersionSynopsisFunction((metadata) => {
            const totalFiles = metadata.files.length;
            return {
                ...metadata,
                synopsis: {
                    fileCount: totalFiles,
                    averageRecordsPerFile: metadata.totalRecords / totalFiles,
                },
            };
        });

        const testData = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
        await store.write(testData);

        const metadata = store.getMetadata();
        expect(metadata.synopsis).toBeDefined();
        expect(metadata.synopsis.fileCount).toBe(1);
        expect(metadata.synopsis.averageRecordsPerFile).toBe(100);
    });

    it("handles appending data to existing version", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "append",
            pageSize: 100,
        });

        // First write
        await store.write(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })));
        const v1 = store.getCurrentVersion();

        // Second write to same version (append)
        await store.write(Array.from({ length: 30 }, (_, i) => ({ id: i + 51 })));
        const v2 = store.getCurrentVersion();

        expect(v1).toBe(v2); // Same version

        const metadata = store.getMetadata();
        expect(metadata.files).toHaveLength(1); // Both writes fit in one file
        expect(metadata.totalRecords).toBe(80);

        const allData = await store.read();
        expect(allData).toHaveLength(80);
        expect(allData[0]).toEqual({ id: 1 });
        expect(allData[79]).toEqual({ id: 80 });
    });

    it("throws error when reading from non-existent version", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "empty",
        });

        await expect(store.read({ version: "2025-01-01T00:00:00Z" })).rejects.toThrow(FileDatabaseError);
        await expect(store.read({ version: "2025-01-01T00:00:00Z" })).rejects.toThrow("No versions found");
    });

    it("handles reading beyond available records gracefully", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "beyond",
        });

        await store.write(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })));

        // Set start record to beyond total records
        store.setStartRecord(51);
        
        // Try to read (should return empty array)
        const emptyPage = await store.read({ nextPage: true, pageSize: 50 });
        expect(emptyPage).toEqual([]);
    });

    it("generates sequential filenames correctly", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "filenames",
            pageSize: 10,
        });

        const testData = Array.from({ length: 35 }, (_, i) => ({ id: i + 1 }));
        await store.write(testData);

        const metadata = store.getMetadata();
        expect(metadata.files).toHaveLength(4);
        expect(metadata.files[0].fileName).toBe("000001.json");
        expect(metadata.files[1].fileName).toBe("000002.json");
        expect(metadata.files[2].fileName).toBe("000003.json");
        expect(metadata.files[3].fileName).toBe("000004.json");
    });

    // Phase 1: New functionality tests
    it("supports getLatestVersion() method", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "latest-version",
        });

        // No versions yet
        expect(await store.getLatestVersion()).toBeNull();

        // Write some data to create a version
        await store.write([{ id: 1, name: "test" }]);
        const latest = await store.getLatestVersion();
        expect(latest).toBeTruthy();
        expect(latest).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it("supports hasData() method for versioned mode", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "has-data-versioned",
        });

        // No data yet
        expect(await store.hasData()).toBe(false);

        // Write some data
        await store.write([{ id: 1 }]);
        expect(await store.hasData()).toBe(true);
    });

    it("supports hasData() method for non-versioned mode", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "has-data-nonversioned",
            versioned: false,
        });

        // No data yet
        expect(await store.hasData()).toBe(false);

        // Write some data
        await store.write([{ id: 1 }]);
        expect(await store.hasData()).toBe(true);
    });

    it("supports detectDataFormat() method", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "detect-format",
        });

        // Empty table
        let format = await store.detectDataFormat();
        expect(format.versioned).toBe(false);
        expect(format.hasMetadata).toBe(false);
        expect(format.dataType).toBe(null);

        // Write versioned data
        await store.write([{ id: 1 }]);
        format = await store.detectDataFormat();
        expect(format.versioned).toBe(true);
        expect(format.hasMetadata).toBe(true);
    });

    it("supports non-versioned mode", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "non-versioned",
            versioned: false,
        });

        const testData = [{ id: 1, name: "test" }];
        await store.write(testData);

        const readData = await store.read();
        expect(readData).toEqual(testData);
    });

    it("throws error for getLatestVersion() in non-versioned mode", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "error-test",
            versioned: false,
        });

        await expect(store.getLatestVersion()).rejects.toThrow("getLatestVersion() only works in versioned mode");
    });

    it("throws error for forceNewVersion in non-versioned mode", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "error-test",
            versioned: false,
        });

        await expect(store.write([{ id: 1 }], { forceNewVersion: true })).rejects.toThrow("Cannot use forceNewVersion in non-versioned mode");
    });

    it("returns empty versions array for non-versioned mode", async () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "versions-test",
            versioned: false,
        });

        const versions = await store.getVersions();
        expect(versions).toEqual([]);
    });

    it("defaults to versioned mode when versioned is not specified", () => {
        const store = new FileDatabase({
            basePath: testBasePath,
            namespace: "test-namespace",
            tableName: "default-test",
        });

        // We can't directly access the private versioned property, but we can test behavior
        expect(() => store.getLatestVersion()).not.toThrow(); // Should not throw since it's versioned by default
    });
});

