import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { MockStorage, computeMockKey } from "../mock-storage.js";
import type { MockResponseData } from "../types.js";

const testLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };

describe("MockStorage CI", () => {
    let tmpDir: string;
    let storage: MockStorage;

    beforeEach(async () => {
        tmpDir = path.join(os.tmpdir(), `mock-storage-${Date.now()}`);
        await fs.mkdir(tmpDir, { recursive: true });
        storage = new MockStorage({ basePath: tmpDir, logger: testLogger });
    });

    afterEach(async () => {
        try {
            await fs.rm(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    });

    it("computeMockKey is deterministic", () => {
        const k1 = computeMockKey("GET", "api.example.com", "/users", "", undefined);
        const k2 = computeMockKey("GET", "api.example.com", "/users", "", undefined);
        expect(k1).toBe(k2);
        expect(k1).toMatch(/^[a-f0-9]{32}$/);

        const k3 = computeMockKey("POST", "api.example.com", "/users", "", { name: "x" });
        expect(k3).not.toBe(k1);
    });

    it("store and find round-trip", async () => {
        const responseData: MockResponseData = {
            status: 200,
            headers: { "content-type": "application/json" },
            data: { id: 1, name: "test" },
        };

        await storage.store("GET", "https://api.example.com/users/1", undefined, responseData);

        const found = await storage.find("GET", "api.example.com", "/users/1", "", undefined);
        expect(found).toEqual(responseData);
    });

    it("find returns null when no match", async () => {
        const found = await storage.find("GET", "api.example.com", "/notfound", "", undefined);
        expect(found).toBeNull();
    });

    it("listKeys returns stored keys", async () => {
        const r1: MockResponseData = { status: 200, headers: {}, data: {} };
        const r2: MockResponseData = { status: 200, headers: {}, data: {} };
        await storage.store("GET", "https://a.com/1", undefined, r1);
        await storage.store("GET", "https://a.com/2", undefined, r2);

        const keys = await storage.listKeys();
        expect(keys).toHaveLength(2);
    });

    it("remove deletes mock", async () => {
        const r: MockResponseData = { status: 200, headers: {}, data: {} };
        await storage.store("GET", "https://a.com/x", undefined, r);
        const before = await storage.find("GET", "a.com", "/x", "", undefined);
        expect(before).not.toBeNull();

        const keys = await storage.listKeys();
        const removed = await storage.remove(keys[0]);
        expect(removed).toBe(true);
        const after = await storage.find("GET", "a.com", "/x", "", undefined);
        expect(after).toBeNull();
    });
});
