import { describe, it, expect } from "vitest";
import { bytesToHumanReadable, humanReadableToBytes } from "../format-utils.js";

describe("Format Utils CI", () => {
    describe("bytesToHumanReadable", () => {
        it("handles zero bytes", () => {
            expect(bytesToHumanReadable(0)).toBe("0 B");
        });

        it("converts bytes to B", () => {
            expect(bytesToHumanReadable(100)).toBe("100 B");
            expect(bytesToHumanReadable(1023)).toBe("1023 B");
        });

        it("converts bytes to KB", () => {
            expect(bytesToHumanReadable(1024)).toBe("1 KB");
            expect(bytesToHumanReadable(2048)).toBe("2 KB");
            expect(bytesToHumanReadable(1536)).toBe("1.5 KB");
        });

        it("converts bytes to MB", () => {
            expect(bytesToHumanReadable(1048576)).toBe("1 MB");
            expect(bytesToHumanReadable(1572864)).toBe("1.5 MB");
            expect(bytesToHumanReadable(5242880)).toBe("5 MB");
        });

        it("converts bytes to GB", () => {
            expect(bytesToHumanReadable(1073741824)).toBe("1 GB");
            expect(bytesToHumanReadable(2147483648)).toBe("2 GB");
            expect(bytesToHumanReadable(5368709120)).toBe("5 GB");
        });

        it("converts bytes to TB", () => {
            expect(bytesToHumanReadable(1099511627776)).toBe("1 TB");
            expect(bytesToHumanReadable(2199023255552)).toBe("2 TB");
        });

        it("converts bytes to PB", () => {
            expect(bytesToHumanReadable(1125899906842624)).toBe("1 PB");
        });

        it("rounds to 2 decimal places", () => {
            expect(bytesToHumanReadable(1234567)).toBe("1.18 MB");
            expect(bytesToHumanReadable(123456789)).toBe("117.74 MB");
        });

        it("handles fractional units", () => {
            expect(bytesToHumanReadable(1536)).toBe("1.5 KB");
            expect(bytesToHumanReadable(1610612736)).toBe("1.5 GB");
        });
    });

    describe("humanReadableToBytes", () => {
        it("converts B to bytes", () => {
            expect(humanReadableToBytes("100 B")).toBe(100);
            expect(humanReadableToBytes("1023B")).toBe(1023);
        });

        it("converts KB to bytes", () => {
            expect(humanReadableToBytes("1 KB")).toBe(1024);
            expect(humanReadableToBytes("2KB")).toBe(2048);
            expect(humanReadableToBytes("1.5 KB")).toBe(1536);
        });

        it("converts MB to bytes", () => {
            expect(humanReadableToBytes("1 MB")).toBe(1048576);
            expect(humanReadableToBytes("1.5MB")).toBe(1572864);
            expect(humanReadableToBytes("5 MB")).toBe(5242880);
        });

        it("converts GB to bytes", () => {
            expect(humanReadableToBytes("1 GB")).toBe(1073741824);
            expect(humanReadableToBytes("2GB")).toBe(2147483648);
        });

        it("converts TB to bytes", () => {
            expect(humanReadableToBytes("1 TB")).toBe(1099511627776);
            expect(humanReadableToBytes("2TB")).toBe(2199023255552);
        });

        it("converts PB to bytes", () => {
            expect(humanReadableToBytes("1 PB")).toBe(1125899906842624);
        });

        it("handles case-insensitive units", () => {
            expect(humanReadableToBytes("1 mb")).toBe(1048576);
            expect(humanReadableToBytes("1 Mb")).toBe(1048576);
            expect(humanReadableToBytes("1 MB")).toBe(1048576);
        });

        it("handles whitespace variations", () => {
            expect(humanReadableToBytes("1MB")).toBe(1048576);
            expect(humanReadableToBytes("1 MB")).toBe(1048576);
            expect(humanReadableToBytes("1  MB")).toBe(1048576);
            expect(humanReadableToBytes("  1 MB  ")).toBe(1048576);
        });

        it("handles decimal values", () => {
            expect(humanReadableToBytes("1.5 KB")).toBe(1536);
            expect(humanReadableToBytes("2.25 MB")).toBe(2359296);
            expect(humanReadableToBytes("0.5 GB")).toBe(536870912);
        });

        it("rounds to nearest integer", () => {
            expect(humanReadableToBytes("1.333 KB")).toBe(1365); // Math.round(1.333 * 1024)
        });

        it("throws error for invalid format", () => {
            expect(() => humanReadableToBytes("invalid")).toThrow("Invalid format");
            expect(() => humanReadableToBytes("MB")).toThrow("Invalid format");
            expect(() => humanReadableToBytes("100")).toThrow("Invalid format");
            expect(() => humanReadableToBytes("")).toThrow("Invalid format");
        });

        it("throws error for unknown unit", () => {
            expect(() => humanReadableToBytes("100 XB")).toThrow("Unknown unit: XB");
            expect(() => humanReadableToBytes("1 YB")).toThrow("Unknown unit: YB");
        });
    });

    describe("round-trip conversion", () => {
        it("maintains consistency for common values", () => {
            const testValues = [1024, 1048576, 1073741824, 2147483648];
            
            for (const bytes of testValues) {
                const human = bytesToHumanReadable(bytes);
                const converted = humanReadableToBytes(human);
                expect(converted).toBe(bytes);
            }
        });

        it("handles fractional values with rounding", () => {
            const bytes = 1536; // 1.5 KB
            const human = bytesToHumanReadable(bytes); // "1.5 KB"
            const converted = humanReadableToBytes(human); // 1536
            expect(converted).toBe(bytes);
        });
    });
});

