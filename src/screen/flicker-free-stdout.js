/**
 * Ink's log-update always does eraseLines(whole frame) + reprint. That blank
 * intermediate is the flicker. We intercept those writes and:
 *   1. Update only changed lines in place (like less)
 *   2. Wrap the paint in CSI 2026 so supporting terminals show one atomic frame
 */

const ESC = "\u001b[";
const ERASE_LINE = `${ESC}2K`;
const CURSOR_UP = `${ESC}1A`;
const CURSOR_LEFT = `${ESC}G`;
const SYNC_BEGIN = `${ESC}?2026h`;
const SYNC_END = `${ESC}?2026l`;

/** Same formula as ansi-escapes `eraseLines(count)`. */
export function inkEraseLines(count) {
    let clear = "";
    for (let i = 0; i < count; i++) {
        clear += ERASE_LINE + (i < count - 1 ? CURSOR_UP : "");
    }
    if (count) clear += CURSOR_LEFT;
    return clear;
}

const ERASE_LINES_RE = /^(?:\u001b\[2K\u001b\[1A)*\u001b\[2K\u001b\[G/;
const CLEAR_TERMINAL_RE = /^\u001b\[2J/;

export function splitInkLogWrite(str) {
    const s = String(str ?? "");
    if (CLEAR_TERMINAL_RE.test(s)) {
        return { kind: "clear", body: s };
    }
    const m = s.match(ERASE_LINES_RE);
    if (m) {
        return { kind: "frame", body: s.slice(m[0].length) };
    }
    return { kind: "raw", body: s };
}

export function splitFrameLines(body) {
    return String(body ?? "").split("\n");
}

/**
 * Cursor is assumed to sit on the line after the previous frame (Ink's
 * trailing newline). Move to the first line and rewrite only diffs.
 */
export function paintFrameDiff(prevLines, nextLines) {
    const prev = Array.isArray(prevLines) ? prevLines : [];
    const next = Array.isArray(nextLines) ? nextLines : [];
    const max = Math.max(prev.length, next.length);
    if (max === 0) return "";

    let out = SYNC_BEGIN;
    if (prev.length > 0) {
        out += `${ESC}${prev.length}A`;
    }

    for (let i = 0; i < max; i++) {
        const a = prev[i];
        const b = next[i];
        if (b === undefined) {
            out += ERASE_LINE;
        } else if (a !== b) {
            out += ERASE_LINE + b;
        }
        if (i < max - 1) out += "\n";
    }
    out += CURSOR_LEFT;
    out += SYNC_END;
    return out;
}

/**
 * @param {NodeJS.WriteStream} [stdout]
 * @returns {NodeJS.WriteStream}
 */
export function createFlickerFreeStdout(stdout = process.stdout) {
    let prevLines = [];

    const write = (chunk, encoding, cb) => {
        const done = typeof encoding === "function" ? encoding : cb;
        const enc = typeof encoding === "function" ? undefined : encoding;
        const str = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        const parsed = splitInkLogWrite(str);

        const finish = (payload) => {
            const ok = stdout.write(payload, enc);
            if (typeof done === "function") done();
            return ok;
        };

        if (parsed.kind === "clear") {
            prevLines = [];
            return finish(SYNC_BEGIN + parsed.body + SYNC_END);
        }

        if (parsed.kind === "frame" || (parsed.kind === "raw" && parsed.body.includes("\n"))) {
            const nextLines = splitFrameLines(parsed.body);
            const painted =
                prevLines.length === 0
                    ? SYNC_BEGIN + parsed.body + SYNC_END
                    : paintFrameDiff(prevLines, nextLines);
            prevLines = nextLines;
            return finish(painted);
        }

        return stdout.write(chunk, encoding, cb);
    };

    return new Proxy(stdout, {
        get(target, prop, receiver) {
            if (prop === "write") return write;
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
