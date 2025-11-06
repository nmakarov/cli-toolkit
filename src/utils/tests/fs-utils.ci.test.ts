import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ensurePath, ensurePathSync, getFileExtension } from "../fs-utils.js";
import fs from "fs";
import path from "path";

describe("FS Utils CI", () => {
    const testBasePath = path.resolve(__dirname, "../../..", "test-data-fs-utils");

    // Clean up test directory after each test
    afterEach(async () => {
        if (fs.existsSync(testBasePath)) {
            await fs.promises.rm(testBasePath, { recursive: true, force: true });
        }
    });

    describe("ensurePath", () => {
        it("creates a new directory when it doesn't exist", async () => {
            const testPath = path.join(testBasePath, "new-folder");
            
            expect(fs.existsSync(testPath)).toBe(false);
            
            const result = await ensurePath(testPath);
            
            expect(fs.existsSync(testPath)).toBe(true);
            expect(result).toBe(path.resolve(testPath));
        });

        it("returns existing directory when it already exists", async () => {
            const testPath = path.join(testBasePath, "existing-folder");
            
            await fs.promises.mkdir(testPath, { recursive: true });
            expect(fs.existsSync(testPath)).toBe(true);
            
            const result = await ensurePath(testPath);
            
            expect(result).toBe(path.resolve(testPath));
            expect(fs.existsSync(testPath)).toBe(true);
        });

        it("creates nested directories recursively", async () => {
            const testPath = path.join(testBasePath, "level1", "level2", "level3");
            
            expect(fs.existsSync(testPath)).toBe(false);
            
            const result = await ensurePath(testPath);
            
            expect(fs.existsSync(testPath)).toBe(true);
            expect(result).toBe(path.resolve(testPath));
        });

        it("handles multiple path parts as separate arguments", async () => {
            const result = await ensurePath(testBasePath, "part1", "part2", "part3");
            
            const expectedPath = path.resolve(testBasePath, "part1", "part2", "part3");
            expect(result).toBe(expectedPath);
            expect(fs.existsSync(expectedPath)).toBe(true);
        });

        it("resolves relative paths to absolute", async () => {
            const result = await ensurePath("./test-relative-path");
            
            expect(path.isAbsolute(result)).toBe(true);
            expect(fs.existsSync(result)).toBe(true);
            
            // Clean up
            await fs.promises.rm(result, { recursive: true, force: true });
        });

        it("handles paths with special characters", async () => {
            const testPath = path.join(testBasePath, "folder-with-dashes", "folder_with_underscores");
            
            const result = await ensurePath(testPath);
            
            expect(fs.existsSync(testPath)).toBe(true);
            expect(result).toBe(path.resolve(testPath));
        });

        it("is idempotent (can be called multiple times)", async () => {
            const testPath = path.join(testBasePath, "idempotent-test");
            
            const result1 = await ensurePath(testPath);
            const result2 = await ensurePath(testPath);
            const result3 = await ensurePath(testPath);
            
            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
            expect(fs.existsSync(testPath)).toBe(true);
        });
    });

    describe("ensurePathSync", () => {
        it("creates a new directory synchronously when it doesn't exist", () => {
            const testPath = path.join(testBasePath, "sync-new-folder");
            
            expect(fs.existsSync(testPath)).toBe(false);
            
            const result = ensurePathSync(testPath);
            
            expect(fs.existsSync(testPath)).toBe(true);
            expect(result).toBe(path.resolve(testPath));
        });

        it("returns existing directory when it already exists", () => {
            const testPath = path.join(testBasePath, "sync-existing-folder");
            
            fs.mkdirSync(testPath, { recursive: true });
            expect(fs.existsSync(testPath)).toBe(true);
            
            const result = ensurePathSync(testPath);
            
            expect(result).toBe(path.resolve(testPath));
            expect(fs.existsSync(testPath)).toBe(true);
        });

        it("creates nested directories recursively", () => {
            const testPath = path.join(testBasePath, "sync-level1", "sync-level2", "sync-level3");
            
            expect(fs.existsSync(testPath)).toBe(false);
            
            const result = ensurePathSync(testPath);
            
            expect(fs.existsSync(testPath)).toBe(true);
            expect(result).toBe(path.resolve(testPath));
        });

        it("handles multiple path parts as separate arguments", () => {
            const result = ensurePathSync(testBasePath, "sync-part1", "sync-part2", "sync-part3");
            
            const expectedPath = path.resolve(testBasePath, "sync-part1", "sync-part2", "sync-part3");
            expect(result).toBe(expectedPath);
            expect(fs.existsSync(expectedPath)).toBe(true);
        });

        it("resolves relative paths to absolute", () => {
            const result = ensurePathSync("./test-relative-sync");
            
            expect(path.isAbsolute(result)).toBe(true);
            expect(fs.existsSync(result)).toBe(true);
            
            // Clean up
            fs.rmSync(result, { recursive: true, force: true });
        });

        it("is idempotent (can be called multiple times)", () => {
            const testPath = path.join(testBasePath, "sync-idempotent-test");
            
            const result1 = ensurePathSync(testPath);
            const result2 = ensurePathSync(testPath);
            const result3 = ensurePathSync(testPath);
            
            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
            expect(fs.existsSync(testPath)).toBe(true);
        });
    });

    describe("ensurePath vs ensurePathSync", () => {
        it("both produce same results", async () => {
            const asyncPath = path.join(testBasePath, "async-test");
            const syncPath = path.join(testBasePath, "sync-test");
            
            const asyncResult = await ensurePath(asyncPath);
            const syncResult = ensurePathSync(syncPath);
            
            expect(path.isAbsolute(asyncResult)).toBe(true);
            expect(path.isAbsolute(syncResult)).toBe(true);
            expect(fs.existsSync(asyncPath)).toBe(true);
            expect(fs.existsSync(syncPath)).toBe(true);
        });
    });

    describe("getFileExtension", () => {
        it("returns 'json' for json-array data type", () => {
            expect(getFileExtension("json-array")).toBe("json");
        });

        it("returns 'json' for json-object data type", () => {
            expect(getFileExtension("json-object")).toBe("json");
        });

        it("returns 'txt' for text data type", () => {
            expect(getFileExtension("text")).toBe("txt");
        });

        it("returns 'xml' for xml data type", () => {
            expect(getFileExtension("xml")).toBe("xml");
        });

        it("returns 'json' as default for unknown data type", () => {
            expect(getFileExtension("unknown")).toBe("json");
            expect(getFileExtension("csv")).toBe("json");
            expect(getFileExtension("")).toBe("json");
        });

        it("is case-sensitive", () => {
            expect(getFileExtension("JSON-ARRAY")).toBe("json"); // Default, not recognized
            expect(getFileExtension("Text")).toBe("json"); // Default, not recognized
            expect(getFileExtension("XML")).toBe("json"); // Default, not recognized
        });

        it("handles all standard FileDatabase data types", () => {
            const expectedExtensions: Record<string, string> = {
                "json-array": "json",
                "json-object": "json",
                "text": "txt",
                "xml": "xml",
            };

            for (const [dataType, expectedExt] of Object.entries(expectedExtensions)) {
                expect(getFileExtension(dataType)).toBe(expectedExt);
            }
        });
    });
});

