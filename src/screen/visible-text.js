/**
 * Terminal-visible width: ignore ANSI, count code points as one cell.
 * Keeps scrollbar / pad math aligned when log lines carry chalk codes.
 */

const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(text) {
    return String(text ?? "").replace(ANSI_RE, "");
}

export function visibleWidth(text) {
    return [...stripAnsi(text)].length;
}

/**
 * First `cols` visible cells, preserving ANSI in that span.
 */
export function sliceVisible(text, cols) {
    const w = Math.max(0, Math.floor(Number(cols) || 0));
    const s = String(text ?? "");
    if (w === 0) return "";
    let vis = 0;
    let out = "";
    let i = 0;
    while (i < s.length && vis < w) {
        ANSI_RE.lastIndex = i;
        const m = ANSI_RE.exec(s);
        if (m && m.index === i) {
            out += m[0];
            i += m[0].length;
            continue;
        }
        const cp = s.codePointAt(i);
        const ch = String.fromCodePoint(cp);
        out += ch;
        i += ch.length;
        vis += 1;
    }
    return out;
}

export function padEndVisible(text, cols) {
    const w = Math.max(0, Math.floor(Number(cols) || 0));
    const s = String(text ?? "");
    const vis = visibleWidth(s);
    if (vis === w) return s;
    if (vis > w) return sliceVisible(s, w);
    return s + " ".repeat(w - vis);
}

/**
 * Hard-wrap on visible columns (keeps empty lines). ANSI stays with its text.
 */
export function wrapTextLines(text, cols) {
    const w = Math.max(1, Math.floor(Number(cols) || 1));
    const out = [];
    for (const raw of String(text ?? "").split("\n")) {
        if (raw.length === 0) {
            out.push("");
            continue;
        }
        if (visibleWidth(raw) <= w) {
            out.push(raw);
            continue;
        }
        let rest = raw;
        while (visibleWidth(rest) > w) {
            const head = sliceVisible(rest, w);
            out.push(head);
            rest = rest.slice(head.length);
        }
        if (rest.length > 0) out.push(rest);
    }
    return out;
}
