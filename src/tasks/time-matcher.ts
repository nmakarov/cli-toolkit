const RANGES = ["0-59", "0-59", "0-23", "1-31", "1-12", "0-6"];

export function resolveAsterisks(field: string, range: string): string {
    return field.includes("*") ? field.replace("*", range) : field;
}

export function resolveRanges(field: string): string {
    const regex = /(\d+)-(\d+)/;
    let current = field;
    while (true) {
        const match = regex.exec(current);
        if (!match) break;
        const raw = match[0];
        let first = Number(match[1]);
        let last = Number(match[2]);
        if (last < first) {
            [first, last] = [last, first];
        }
        const values: number[] = [];
        for (let i = first; i <= last; i += 1) {
            values.push(i);
        }
        current = current.replace(raw, values.join(","));
    }
    return current;
}

export function resolveSteps(field: string): string {
    const match = /^(.+)\/(\d+)$/.exec(field);
    if (!match) return field;
    const base = match[1];
    const step = Number(match[2]);
    if (!Number.isFinite(step) || step <= 0) return field;
    return base
        .split(",")
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v % step === 0)
        .join(",");
}

export function convertPattern(pattern: string): string[] {
    const parts = pattern.trim().split(/\s+/);
    if (parts.length !== 6) {
        throw new Error(`Invalid schedule "${pattern}". Expected 6 fields: sec min hour day month weekday`);
    }
    return parts
        .map((field, idx) => resolveAsterisks(field, RANGES[idx]))
        .map((field) => resolveRanges(field))
        .map((field) => resolveSteps(field));
}

function fieldMatches(field: string, value: number): boolean {
    const allowed = field.split(",").map((v) => Number(v));
    return allowed.includes(value);
}

/** Parsed 6-field pattern from {@link convertPattern} */
export type ParsedTimePattern = string[];

export function matchesParsedPattern(parsed: ParsedTimePattern, date: Date): boolean {
    return (
        fieldMatches(parsed[0], date.getSeconds()) &&
        fieldMatches(parsed[1], date.getMinutes()) &&
        fieldMatches(parsed[2], date.getHours()) &&
        fieldMatches(parsed[3], date.getDate()) &&
        fieldMatches(parsed[4], date.getMonth() + 1) &&
        fieldMatches(parsed[5], date.getDay())
    );
}

export function timeMatcher(pattern: string, date: Date = new Date()): boolean {
    const parsed = convertPattern(pattern);
    return matchesParsedPattern(parsed, date);
}

const MS_PER_SECOND = 1000;
const DEFAULT_SEARCH_HORIZON_MS = 10 * 365 * 24 * 60 * 60 * MS_PER_SECOND;

/**
 * Earliest calendar second **strictly after** `from` where the schedule matches.
 * Use this to sleep until the next run instead of polling {@link timeMatcher} and risking missed seconds.
 *
 * @param pattern Same 6-field format as {@link timeMatcher}: `sec min hour day month weekday`
 * @param from Reference instant (default: now). Matching is second-granularity; search starts at the next second after `from`.
 * @param maxSearchMs Abort if no match within this window (default ~10 years).
 */
export function nextTimeMatch(
    pattern: string,
    from: Date = new Date(),
    maxSearchMs: number = DEFAULT_SEARCH_HORIZON_MS
): Date {
    const parsed = convertPattern(pattern);
    let t = Math.ceil((from.getTime() + 1) / MS_PER_SECOND) * MS_PER_SECOND;
    const end = t + maxSearchMs;
    while (t <= end) {
        const date = new Date(t);
        if (matchesParsedPattern(parsed, date)) {
            return date;
        }
        t += MS_PER_SECOND;
    }
    throw new Error(
        `nextTimeMatch: no match for "${pattern}" within ${maxSearchMs}ms after ${from.toISOString()}`
    );
}
