/**
 * CI tests for os-utils
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ execSync: mockExecSync }));

// Import after mock so os-utils gets mocked execSync
const { getFreeDiskSpace } = await import("../os-utils.js");

describe("os-utils CI", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        mockExecSync.mockReset();
        vi.restoreAllMocks();
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("returns null on Windows", () => {
        Object.defineProperty(process, "platform", { value: "win32", configurable: true });
        expect(getFreeDiskSpace("/some/path")).toBeNull();
    });

    it("returns null when path and parent do not exist on Unix and df throws", () => {
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
        vi.spyOn(fs, "existsSync").mockReturnValue(false);
        mockExecSync.mockImplementation(() => {
            throw new Error("df failed");
        });
        const result = getFreeDiskSpace("/nonexistent/deep/path");
        expect(result).toBeNull();
    });

    it("when path and parent do not exist on Unix uses root path for df", () => {
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
        vi.spyOn(fs, "existsSync").mockReturnValue(false);
        mockExecSync.mockReturnValue(
            "Filesystem     1K-blocks   Used Available\n/dev/root  1000000  400000  600000"
        );
        const result = getFreeDiskSpace("/nonexistent/deep/path");
        expect(result).toBe(600000 * 1024);
        expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('"/"'), expect.any(Object));
    });

    it("uses parent directory when path does not exist but parent does", () => {
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
        const parentDir = path.resolve(process.cwd(), "..");
        vi.spyOn(fs, "existsSync").mockImplementation((p) => p === parentDir || p === path.dirname(parentDir));
        mockExecSync.mockReturnValue(
            "Filesystem     1K-blocks   Used Available\n/dev/disk1  1000000  500000  500000"
        );
        const result = getFreeDiskSpace(path.join(process.cwd(), "nonexistent"));
        expect(result).toBe(500000 * 1024);
    });

    it("returns null when execSync throws", () => {
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
        vi.spyOn(fs, "existsSync").mockReturnValue(true);
        mockExecSync.mockImplementation(() => {
            throw new Error("df failed");
        });
        expect(getFreeDiskSpace(process.cwd())).toBeNull();
    });

    it("returns free space in bytes on Unix when path exists", () => {
        Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
        vi.spyOn(fs, "existsSync").mockReturnValue(true);
        mockExecSync.mockReturnValue(
            "Filesystem     1K-blocks   Used Available\n/dev/disk1s1  976490576 500000000 476490576"
        );
        const result = getFreeDiskSpace(process.cwd());
        expect(result).toBe(476490576 * 1024);
    });
});
