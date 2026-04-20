import { describe, it, expect } from "vitest";
import {
    convertPattern,
    matchesParsedPattern,
    nextTimeMatch,
    resolveAsterisks,
    resolveRanges,
    resolveSteps,
    timeMatcher,
} from "../time-matcher.js";

function expectedWildcardPattern(): string[] {
    const sec = Array.from({ length: 60 }, (_, i) => String(i)).join(",");
    const min = sec;
    const hour = Array.from({ length: 24 }, (_, i) => String(i)).join(",");
    const day = Array.from({ length: 31 }, (_, i) => String(i + 1)).join(",");
    const month = Array.from({ length: 12 }, (_, i) => String(i + 1)).join(",");
    const weekday = Array.from({ length: 7 }, (_, i) => String(i)).join(",");
    return [sec, min, hour, day, month, weekday];
}

describe("resolveAsterisks", () => {
    it("replaces the first * with the field range", () => {
        expect(resolveAsterisks("*", "0-59")).toBe("0-59");
        expect(resolveAsterisks("*/2", "0-59")).toBe("0-59/2");
        expect(resolveAsterisks("5", "0-59")).toBe("5");
    });
});

describe("resolveRanges", () => {
    it("expands numeric ranges to comma lists", () => {
        expect(resolveRanges("1-5")).toBe("1,2,3,4,5");
        expect(resolveRanges("10-12")).toBe("10,11,12");
        expect(resolveRanges("5-3")).toBe("3,4,5");
        expect(resolveRanges("1,3-5,7")).toBe("1,3,4,5,7");
    });

    it("leaves non-range inputs unchanged", () => {
        expect(resolveRanges("5")).toBe("5");
        expect(resolveRanges("1,2,3")).toBe("1,2,3");
    });
});

describe("resolveSteps", () => {
    it("filters comma-separated numbers by step divisor", () => {
        expect(resolveSteps(resolveRanges("0-9/2"))).toBe("0,2,4,6,8");
        expect(resolveSteps(resolveRanges("1,2,3,4,5,6/3"))).toBe("3,6");
    });

    it("returns the input unchanged when no /step suffix", () => {
        expect(resolveSteps("1,2,3")).toBe("1,2,3");
    });
});

describe("convertPattern", () => {
    it("normalizes all-wildcard schedule", () => {
        expect(convertPattern("* * * * * *")).toEqual(expectedWildcardPattern());
    });

    it("normalizes */15 for seconds and wildcards elsewhere", () => {
        const p = convertPattern("*/15 * * * * *");
        expect(p[0]).toBe("0,15,30,45");
        expect(p.slice(1)).toEqual(expectedWildcardPattern().slice(1));
    });

    it("trims whitespace", () => {
        expect(convertPattern("  * * * * * *  ")).toEqual(expectedWildcardPattern());
    });

    it("throws when the pattern does not have exactly six fields", () => {
        expect(() => convertPattern("* * * * *")).toThrow(/Expected 6 fields/);
        expect(() => convertPattern("* * * * * * *")).toThrow(/Expected 6 fields/);
    });
});

describe("matchesParsedPattern", () => {
    it("matches when every field aligns with the date", () => {
        const parsed = convertPattern("30 15 12 10 11 0");
        const date = new Date("2024-11-10T12:15:30");
        expect(matchesParsedPattern(parsed, date)).toBe(true);
    });

    it("rejects when any field mismatches", () => {
        const parsed = convertPattern("29 15 12 10 11 0");
        const date = new Date("2024-11-10T12:15:30");
        expect(matchesParsedPattern(parsed, date)).toBe(false);
    });
});

describe("timeMatcher", () => {
    it("matches any instant for all wildcards", () => {
        const date = new Date("2024-11-10T12:15:30");
        expect(timeMatcher("* * * * * *", date)).toBe(true);
    });

    it("matches an exact timestamp", () => {
        const date = new Date("2024-11-10T12:15:30");
        expect(timeMatcher("30 15 12 10 11 0", date)).toBe(true);
        expect(timeMatcher("29 15 12 10 11 0", date)).toBe(false);
    });

    it("matches on specific minute, hour, day, month with wildcards", () => {
        const date = new Date("2024-11-10T12:15:30");
        expect(timeMatcher("* 15 12 * * *", date)).toBe(true);
        expect(timeMatcher("30 * * 10 11 *", date)).toBe(true);
    });

    it("uses local weekday (Sunday = 0)", () => {
        const sunday = new Date("2025-06-15T15:00:00");
        expect(sunday.getDay()).toBe(0);
        expect(timeMatcher("0 0 * * * 0", sunday)).toBe(true);
        expect(timeMatcher("0 0 * * * 1", sunday)).toBe(false);
    });
});

describe("nextTimeMatch", () => {
    it("returns the next second after `from` when pattern is every second", () => {
        const from = new Date("2025-06-15T12:00:00.500Z");
        const next = nextTimeMatch("* * * * * *", from);
        expect(next.toISOString()).toBe("2025-06-15T12:00:01.000Z");
        expect(timeMatcher("* * * * * *", next)).toBe(true);
    });

    it("skips the current second when `from` is on a second boundary", () => {
        const from = new Date("2025-06-15T12:00:00.000Z");
        const next = nextTimeMatch("* * * * * *", from);
        expect(next.toISOString()).toBe("2025-06-15T12:00:01.000Z");
    });

    it("finds second 0 in the next minute", () => {
        const from = new Date("2025-06-15T12:00:30.000Z");
        const next = nextTimeMatch("0 * * * * *", from);
        expect(next.toISOString()).toBe("2025-06-15T12:01:00.000Z");
        expect(next.getSeconds()).toBe(0);
    });

    it("returns an instant that satisfies timeMatcher", () => {
        const from = new Date("2025-06-15T12:00:30.000Z");
        const pattern = "0 * * * * *";
        const next = nextTimeMatch(pattern, from, 120 * 1000);
        expect(timeMatcher(pattern, next)).toBe(true);
        expect(next.getTime()).toBeGreaterThan(from.getTime());
        expect(next.getSeconds()).toBe(0);
    });

    it("throws when nothing matches within maxSearchMs", () => {
        const from = new Date("2025-06-15T12:00:00.000Z");
        expect(() => nextTimeMatch("0 0 0 1 1 *", from, 5000)).toThrow(/no match/);
    });

    it("finds the next 15-second tick for */15 on seconds", () => {
        const from = new Date("2025-06-15T12:00:07.000Z");
        const next = nextTimeMatch("*/15 * * * * *", from);
        expect(next.getSeconds()).toBe(15);
        expect(timeMatcher("*/15 * * * * *", next)).toBe(true);
    });
});
