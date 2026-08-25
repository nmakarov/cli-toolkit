/**
 * Typed + pasted text for Ink `useInput`.
 *
 * Ink calls the handler once with the full string when the user pastes more
 * than one character. Terminals also wrap paste in CSI 200~/201~ (bracketed
 * paste); those markers must not land in the field.
 */

const BRACKETED_PASTE_RE = /\u001b\[200~|\u001b\[201~|\[200~|\[201~/g;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeTextInput(input, { allowNewlines = false } = {}) {
    let s = String(input ?? "").replace(BRACKETED_PASTE_RE, "");
    if (!allowNewlines) s = s.replace(/[\r\n]+/g, "");
    else s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return s.replace(CONTROL_RE, "");
}

function isTextInsertKey(key) {
    if (!key) return true;
    if (key.return || key.escape || key.tab) return false;
    if (key.backspace || key.delete) return false;
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return false;
    if (key.pageUp || key.pageDown) return false;
    if (key.ctrl) return false;
    return true;
}

/**
 * @param {string} current
 * @param {string} input
 * @param {object} key
 * @param {{ allowNewlines?: boolean, accept?: RegExp }} [opts]
 * @returns {string|null} next value, or null if this key is not text
 */
export function nextTextInputValue(current, input, key, opts = {}) {
    const cur = String(current ?? "");
    if (key?.backspace || key?.delete) return cur.slice(0, -1);
    if (!isTextInsertKey(key)) return null;

    let chunk = sanitizeTextInput(input, opts);
    if (opts.accept instanceof RegExp) {
        chunk = [...chunk].filter((ch) => opts.accept.test(ch)).join("");
    }
    if (!chunk) return null;
    return cur + chunk;
}
