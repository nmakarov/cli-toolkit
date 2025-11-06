import { describe, it, expect } from "vitest";
import {
    formatDate,
    toISOString,
    nowISO,
    fromISOString,
    dateDiff,
    isTimestampFolder,
    generateVersionName,
} from "../date-utils.js";

describe("Date Utils CI", () => {
    describe("formatDate", () => {
        it("formats Date object to ISO string", () => {
            const date = new Date("2025-01-01T12:00:00.000Z");
            expect(formatDate(date)).toBe("2025-01-01T12:00:00.000Z");
        });

        it("formats ISO string to ISO string", () => {
            expect(formatDate("2025-01-01T12:00:00.000Z")).toBe("2025-01-01T12:00:00.000Z");
        });

        it("formats timestamp number to ISO string", () => {
            const timestamp = new Date("2025-01-01T12:00:00.000Z").getTime();
            expect(formatDate(timestamp)).toBe("2025-01-01T12:00:00.000Z");
        });

        it("returns empty string for undefined", () => {
            expect(formatDate(undefined)).toBe("");
        });

        it("returns empty string for null", () => {
            expect(formatDate(null as any)).toBe("");
        });

        it("returns empty string for invalid date string", () => {
            expect(formatDate("invalid-date")).toBe("");
        });

        it("formats to iso-date (date only)", () => {
            expect(formatDate("2025-01-01T12:30:45.000Z", { format: "iso-date" })).toBe("2025-01-01");
        });

        it("formats to iso-time (time only)", () => {
            expect(formatDate("2025-01-01T12:30:45.000Z", { format: "iso-time" })).toBe("12:30:45.000Z");
        });

        it("formats to human readable (UTC)", () => {
            const result = formatDate("2025-01-01T12:00:00.000Z", { format: "human" });
            expect(result).toContain("2025");
            expect(result).toContain("Jan");
        });

        it("formats to human readable (user timezone)", () => {
            const result = formatDate("2025-01-01T12:00:00.000Z", { format: "human", timezone: "user" });
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
        });
    });

    describe("toISOString", () => {
        it("converts Date to ISO string", () => {
            const date = new Date("2025-01-01T12:00:00.000Z");
            expect(toISOString(date)).toBe("2025-01-01T12:00:00.000Z");
        });

        it("converts string to ISO string", () => {
            expect(toISOString("2025-01-01T12:00:00.000Z")).toBe("2025-01-01T12:00:00.000Z");
        });

        it("converts timestamp to ISO string", () => {
            const timestamp = new Date("2025-01-01T12:00:00.000Z").getTime();
            expect(toISOString(timestamp)).toBe("2025-01-01T12:00:00.000Z");
        });

        it("returns empty string for undefined", () => {
            expect(toISOString(undefined)).toBe("");
        });
    });

    describe("nowISO", () => {
        it("returns current time as ISO string", () => {
            const now = nowISO();
            expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            
            // Should be close to current time
            const parsed = new Date(now);
            const diff = Math.abs(Date.now() - parsed.getTime());
            expect(diff).toBeLessThan(1000); // Within 1 second
        });
    });

    describe("fromISOString", () => {
        it("converts ISO string to Date object", () => {
            const date = fromISOString("2025-01-01T12:00:00.000Z");
            expect(date).toBeInstanceOf(Date);
            expect(date.getTime()).toBe(new Date("2025-01-01T12:00:00.000Z").getTime());
        });

        it("handles ISO strings without milliseconds", () => {
            const date = fromISOString("2025-01-01T12:00:00Z");
            expect(date).toBeInstanceOf(Date);
            expect(date.toISOString()).toBe("2025-01-01T12:00:00.000Z");
        });
    });

    describe("dateDiff", () => {
        it("calculates difference in milliseconds", () => {
            const start = "2025-01-01T12:00:00.000Z";
            const end = "2025-01-01T12:00:01.500Z";
            const diff = dateDiff(start, end);
            expect(diff.milliseconds).toBe(1500);
        });

        it("calculates difference in seconds", () => {
            const start = "2025-01-01T12:00:00.000Z";
            const end = "2025-01-01T12:01:00.000Z";
            const diff = dateDiff(start, end);
            expect(diff.seconds).toBe(60);
        });

        it("calculates difference in minutes", () => {
            const start = "2025-01-01T12:00:00.000Z";
            const end = "2025-01-01T13:30:00.000Z";
            const diff = dateDiff(start, end);
            expect(diff.minutes).toBe(90);
        });

        it("calculates difference in hours", () => {
            const start = "2025-01-01T12:00:00.000Z";
            const end = "2025-01-01T18:00:00.000Z";
            const diff = dateDiff(start, end);
            expect(diff.hours).toBe(6);
        });

        it("calculates difference in days", () => {
            const start = "2025-01-01T12:00:00.000Z";
            const end = "2025-01-05T12:00:00.000Z";
            const diff = dateDiff(start, end);
            expect(diff.days).toBe(4);
        });

        it("handles Date objects", () => {
            const start = new Date("2025-01-01T12:00:00.000Z");
            const end = new Date("2025-01-01T13:00:00.000Z");
            const diff = dateDiff(start, end);
            expect(diff.hours).toBe(1);
            expect(diff.minutes).toBe(60);
        });

        it("handles negative differences (end before start)", () => {
            const start = "2025-01-01T12:00:00.000Z";
            const end = "2025-01-01T11:00:00.000Z";
            const diff = dateDiff(start, end);
            expect(diff.hours).toBe(-1);
            expect(diff.minutes).toBe(-60);
        });

        it("returns all units in diff object", () => {
            const start = "2025-01-01T00:00:00.000Z";
            const end = "2025-01-02T01:30:45.500Z";
            const diff = dateDiff(start, end);
            
            expect(diff.milliseconds).toBe(91845500);
            expect(diff.seconds).toBe(91845);
            expect(diff.minutes).toBe(1530);
            expect(diff.hours).toBe(25);
            expect(diff.days).toBe(1);
        });
    });

    describe("isTimestampFolder", () => {
        it("recognizes valid ISO8601 timestamp without milliseconds", () => {
            expect(isTimestampFolder("2025-01-01T12:00:00Z")).toBe(true);
        });

        it("recognizes valid ISO8601 timestamp with milliseconds", () => {
            expect(isTimestampFolder("2025-01-01T12:00:00.000Z")).toBe(true);
        });

        it("rejects folder name without timestamp format", () => {
            expect(isTimestampFolder("my-folder")).toBe(false);
            expect(isTimestampFolder("2025-01-01")).toBe(false);
            expect(isTimestampFolder("12:00:00")).toBe(false);
        });

        it("rejects invalid date values", () => {
            expect(isTimestampFolder("2025-13-01T12:00:00Z")).toBe(false); // Invalid month
            expect(isTimestampFolder("2025-01-32T12:00:00Z")).toBe(false); // Invalid day
            expect(isTimestampFolder("2025-01-01T25:00:00Z")).toBe(false); // Invalid hour
        });

        it("rejects malformed timestamp strings", () => {
            expect(isTimestampFolder("2025-1-1T12:0:0Z")).toBe(false); // Missing leading zeros
            expect(isTimestampFolder("2025-01-01 12:00:00")).toBe(false); // Space instead of T
            expect(isTimestampFolder("2025-01-01T12:00:00")).toBe(false); // Missing Z
        });

        it("rejects empty string", () => {
            expect(isTimestampFolder("")).toBe(false);
        });

        it("rejects zero timestamp", () => {
            expect(isTimestampFolder("1970-01-01T00:00:00Z")).toBe(false); // Epoch zero
        });

        it("accepts valid recent timestamps", () => {
            expect(isTimestampFolder("2024-01-01T00:00:01Z")).toBe(true);
            expect(isTimestampFolder("2025-12-31T23:59:59Z")).toBe(true);
        });
    });

    describe("generateVersionName", () => {
        it("generates timestamp without milliseconds when no existing versions", () => {
            const version = generateVersionName();
            expect(version).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
            expect(version).not.toContain(".");
        });

        it("generates timestamp close to current time", () => {
            const version = generateVersionName();
            const date = new Date(version);
            const diff = Math.abs(Date.now() - date.getTime());
            expect(diff).toBeLessThan(2000); // Within 2 seconds
        });

        it("increments by 1 second when existing versions provided", () => {
            const existingVersions = ["2025-01-01T12:00:00Z"];
            const version = generateVersionName(existingVersions);
            expect(version).toBe("2025-01-01T12:00:01Z");
        });

        it("finds maximum timestamp from multiple versions", () => {
            const existingVersions = [
                "2025-01-01T12:00:00Z",
                "2025-01-01T14:00:00Z",
                "2025-01-01T10:00:00Z",
            ];
            const version = generateVersionName(existingVersions);
            expect(version).toBe("2025-01-01T14:00:01Z");
        });

        it("handles existing versions with milliseconds", () => {
            const existingVersions = ["2025-01-01T12:00:00.000Z"];
            const version = generateVersionName(existingVersions);
            expect(version).toBe("2025-01-01T12:00:01Z");
            expect(version).not.toContain(".");
        });

        it("generates unique versions for sequential calls", () => {
            const v1 = generateVersionName([]);
            const v2 = generateVersionName([v1]);
            const v3 = generateVersionName([v1, v2]);
            
            expect(v1).not.toBe(v2);
            expect(v2).not.toBe(v3);
            expect(v1).not.toBe(v3);
            
            // v2 should be 1 second after v1
            const date1 = new Date(v1);
            const date2 = new Date(v2);
            expect(date2.getTime() - date1.getTime()).toBe(1000);
        });

        it("handles empty array same as no argument", () => {
            const v1 = generateVersionName([]);
            expect(v1).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
            
            // Should be close to current time
            const date = new Date(v1);
            const diff = Math.abs(Date.now() - date.getTime());
            expect(diff).toBeLessThan(2000);
        });

        it("maintains ISO8601 format without milliseconds", () => {
            const existingVersions = ["2025-01-01T12:00:00.999Z"];
            const version = generateVersionName(existingVersions);
            
            expect(version).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
            expect(version.split(".").length).toBe(1); // No decimal point
        });
    });
});

