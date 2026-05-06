/**
 * 6-field cron-like matcher: `sec min hour day month weekday`.
 * Fields support `*`, numeric literals, ranges (`1-5`), comma lists (`0,15,30,45`),
 * and step expressions (`*\/10`, `0-30/5`). No named months/weekdays, no
 * `L`/`#`/`?` magic — keep patterns explicit.
 */

/** Field index → `"lo-hi"` range that `*` expands into. Order: sec, min, hour, day, month, weekday. */
const RANGES = ["0-59", "0-59", "0-23", "1-31", "1-12", "0-6"];

/**
 * Replace `*` with a concrete `lo-hi` range so the rest of the pipeline only
 * has to deal with numeric forms.
 *
 * @param {string} field
 * @param {string} range e.g. `"0-59"`
 * @returns {string}
 */
export function resolveAsterisks(field, range) {
    return field.includes("*") ? field.replace("*", range) : field;
}

/**
 * Expand every `lo-hi` run in `field` to the comma-separated list of integers it
 * covers. Handles reversed bounds (`5-2` → `2,3,4,5`). Does not handle steps;
 * run {@link resolveSteps} after this.
 *
 * @param {string} field
 * @returns {string}
 */
export function resolveRanges(field) {
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
        const values = [];
        for (let i = first; i <= last; i += 1) {
            values.push(i);
        }
        current = current.replace(raw, values.join(","));
    }
    return current;
}

/**
 * Apply a `.../step` suffix, keeping only values divisible by `step`.
 * Expects ranges to already be expanded to comma-lists. No-op when the suffix is missing.
 *
 * @param {string} field e.g. `"0,1,2,...,59/10"` → `"0,10,20,30,40,50"`
 * @returns {string}
 */
export function resolveSteps(field) {
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

/**
 * Normalize a raw 6-field schedule string into an array of comma-separated integer
 * lists — one per field, ready for {@link matchesParsedPattern}.
 *
 * @param {string} pattern
 * @returns {string[]}
 * @throws If `pattern` does not contain exactly six whitespace-separated fields.
 */
export function convertPattern(pattern) {
    const parts = pattern.trim().split(/\s+/);
    if (parts.length !== 6) {
        throw new Error(`Invalid schedule "${pattern}". Expected 6 fields: sec min hour day month weekday`);
    }
    return parts
        .map((field, idx) => resolveAsterisks(field, RANGES[idx]))
        .map((field) => resolveRanges(field))
        .map((field) => resolveSteps(field));
}

/**
 * Does `value` appear in the comma-list `field`?
 *
 * @param {string} field
 * @param {number} value
 * @returns {boolean}
 */
function fieldMatches(field, value) {
    const allowed = field.split(",").map((v) => Number(v));
    return allowed.includes(value);
}

/**
 * Check an already-parsed pattern against a `Date`. All six fields must match
 * (month is 1-indexed here; weekday follows `Date#getDay`, 0 = Sunday).
 *
 * @param {string[]} parsed Output of {@link convertPattern}.
 * @param {Date} date
 * @returns {boolean}
 */
export function matchesParsedPattern(parsed, date) {
    return (
        fieldMatches(parsed[0], date.getSeconds()) &&
        fieldMatches(parsed[1], date.getMinutes()) &&
        fieldMatches(parsed[2], date.getHours()) &&
        fieldMatches(parsed[3], date.getDate()) &&
        fieldMatches(parsed[4], date.getMonth() + 1) &&
        fieldMatches(parsed[5], date.getDay())
    );
}

/**
 * One-shot check: does `pattern` match `date`? Parses the pattern each call —
 * fine for the runner loop where we only test one date per tick; use
 * {@link convertPattern} + {@link matchesParsedPattern} if you need to test
 * many dates against the same schedule.
 *
 * @param {string} pattern
 * @param {Date} [date]
 * @returns {boolean}
 */
export function timeMatcher(pattern, date = new Date()) {
    const parsed = convertPattern(pattern);
    return matchesParsedPattern(parsed, date);
}

const MS_PER_SECOND = 1000;
const DEFAULT_SEARCH_HORIZON_MS = 10 * 365 * 24 * 60 * 60 * MS_PER_SECOND;

/**
 * Earliest calendar second strictly after `from` where the schedule matches.
 * Use this to sleep until the next run instead of polling `timeMatcher` and risking missed seconds.
 *
 * @param {string} pattern Same 6-field format as `timeMatcher`: `sec min hour day month weekday`
 * @param {Date} [from=new Date()] Reference instant. Matching is second-granularity; search starts at the next second after `from`.
 * @param {number} [maxSearchMs] Abort if no match within this window (default ~10 years).
 * @returns {Date}
 */
export function nextTimeMatch(
    pattern,
    from = new Date(),
    maxSearchMs = DEFAULT_SEARCH_HORIZON_MS
) {
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
