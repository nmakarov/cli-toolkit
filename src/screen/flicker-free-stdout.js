/**
 * Ink's log-update always does eraseLines(whole frame) + reprint. That blank
 * intermediate is the flicker. We intercept those writes and update only
 * changed lines in place (like less).
 *
 * Ink writes `yogaOutput + "\n"`. After that, the cursor sits on a new empty
 * line — not on a trailing content row. split("\n") includes a final "" for
 * that newline; CUU must use the content-row count, not the split length.
 */

const ESC = "\u001b[";
const ERASE_LINE = `${ESC}2K`;
const CURSOR_UP = `${ESC}1A`;
const CURSOR_LEFT = `${ESC}G`;

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
const CLEAR_TERMINAL_RE = /^\u001b\[2J(?:\u001b\[3J)?(?:\u001b\[H|\u001b\[0f)?/;

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

/** Drop the trailing "" that split() adds for Ink's final newline. */
export function contentRows(lines) {
    const rows = Array.isArray(lines) ? lines.slice() : [];
    if (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    return rows;
}

/**
 * Cursor is on the empty line after the previous frame. Move to the first
 * content row and rewrite only diffs, then park on the line after the new
 * last content row (Ink's convention).
 */
export function paintFrameDiff(prevLines, nextLines) {
    const prev = contentRows(prevLines);
    const next = contentRows(nextLines);
    if (prev.length === 0 && next.length === 0) return "";

    let out = "";
    if (prev.length > 0) {
        out += `${ESC}${prev.length}A`;
    }

    for (let i = 0; i < next.length; i++) {
        if (prev[i] !== next[i]) {
            out += ERASE_LINE + CURSOR_LEFT + next[i];
        }
        out += "\n";
    }

    const leftovers = prev.length - next.length;
    if (leftovers > 0) {
        for (let i = 0; i < leftovers; i++) {
            out += ERASE_LINE;
            if (i < leftovers - 1) out += "\n";
        }
        if (leftovers > 1) {
            out += `${ESC}${leftovers - 1}A`;
        }
        out += CURSOR_LEFT;
    }

    return out;
}

function finishWrite(stdout, payload, enc, done) {
    const ok = stdout.write(payload, enc);
    if (typeof done === "function") done();
    return ok;
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

        if (parsed.kind === "clear") {
            const after = str.replace(CLEAR_TERMINAL_RE, "");
            prevLines = after ? splitFrameLines(after) : [];
            return finishWrite(stdout, str, enc, done);
        }

        if (parsed.kind === "frame") {
            if (parsed.body === "") {
                prevLines = [];
                return finishWrite(stdout, str, enc, done);
            }
            const nextLines = splitFrameLines(parsed.body);
            if (prevLines.length === 0) {
                prevLines = nextLines;
                return finishWrite(stdout, parsed.body, enc, done);
            }
            const painted = paintFrameDiff(prevLines, nextLines);
            prevLines = nextLines;
            return finishWrite(stdout, painted, enc, done);
        }

        if (prevLines.length === 0 && parsed.body.includes("\n")) {
            prevLines = splitFrameLines(parsed.body);
        }
        return stdout.write(chunk, encoding, cb);
    };

    return new Proxy(stdout, {
        get(target, prop) {
            if (prop === "write") return write;
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
