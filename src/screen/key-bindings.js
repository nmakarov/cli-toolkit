/**
 * Key-binding helpers for showScreen (matching + footer labels).
 *
 * Bindings may set `meta` / `ctrl` / `shift` booleans. Plain bindings (flags
 * omitted) do not match when that modifier is held, so `↑` and `⌥↑` can coexist.
 */

/**
 * Stable identity for replace/remove (key + modifiers).
 * @param {{ key: string, meta?: boolean, ctrl?: boolean, shift?: boolean }} b
 */
export function bindingIdentity(b) {
    return [
        String(b?.key ?? ""),
        b?.meta ? "m" : "",
        b?.ctrl ? "c" : "",
        b?.shift ? "s" : "",
    ].join("|");
}

/**
 * @param {{ key: string, meta?: boolean, ctrl?: boolean, shift?: boolean }} binding
 * @param {string} input
 * @param {import("ink").Key} key
 */
export function bindingMatchesInput(binding, input, key) {
    if (!binding?.key) return false;

    let keyMatches = false;
    if (key?.[binding.key]) {
        keyMatches = true;
    } else if (input === binding.key) {
        keyMatches = true;
    } else if (key?.name === binding.key) {
        keyMatches = true;
    }
    if (!keyMatches) return false;

    // Explicit true → require; explicit false → forbid; omitted → forbid if pressed
    // (so plain upArrow does not fire for meta+up).
    const modOk = (flag, pressed) => {
        if (flag === true) return !!pressed;
        if (flag === false) return !pressed;
        return !pressed;
    };

    // Ink's useInput sets `meta: true` whenever `name === "escape"` (Escape is
    // the terminal meta prefix). Treat that as a lone Esc, not Option+key.
    const inkEscapeMeta = binding.key === "escape" && key?.escape;
    if (!inkEscapeMeta && !modOk(binding.meta, key?.meta)) return false;
    if (!modOk(binding.ctrl, key?.ctrl)) return false;
    if (binding.shift !== undefined && !!key?.shift !== !!binding.shift) return false;

    return true;
}

const KEY_LABELS = {
    escape: "esc",
    leftArrow: "←",
    rightArrow: "→",
    upArrow: "↑",
    downArrow: "↓",
    return: "enter",
    pageUp: "PgUp",
    pageDown: "PgDn",
};

/**
 * Human label for one binding (modifiers + key), e.g. `⌥↑`, `^↓`, `PgUp`.
 * @param {{ key: string, meta?: boolean, ctrl?: boolean, shift?: boolean }} binding
 */
export function formatBindingKey(binding) {
    let label = KEY_LABELS[binding.key] || binding.key;
    if (binding.shift) label = `⇧${label}`;
    if (binding.ctrl) label = `^${label}`;
    // ink `meta` is Option/Alt on macOS (⌘ is usually eaten by the terminal).
    if (binding.meta) label = `⌥${label}`;
    return label;
}
