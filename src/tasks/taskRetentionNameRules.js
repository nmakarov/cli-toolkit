/**
 * Shorter retention windows for high-volume ephemeral task names.
 * Apps inject defaults via {@link setTaskRetentionNameRulesDefaults}; runtime
 * may override with `tasksRetentionNameRules` (JSON object name → hours).
 */

/** @type {Record<string, number> | null} */
let injectedDefaults = null;

/**
 * @param {Record<string, number>|null|undefined} map  task name → retention hours
 */
export function setTaskRetentionNameRulesDefaults(map) {
    if (map == null) {
        injectedDefaults = null;
        return;
    }
    injectedDefaults = { ...map };
}

/**
 * @param {unknown} raw JSON string or object from runtime / params
 * @returns {Record<string, number>}
 */
export function parseRetentionNameRulesRaw(raw) {
    if (raw == null || raw === "") return {};
    let obj = raw;
    if (typeof raw === "string") {
        const t = raw.trim();
        if (!t) return {};
        try {
            obj = JSON.parse(t);
        } catch {
            return {};
        }
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out = {};
    for (const [name, hours] of Object.entries(obj)) {
        const h = Number(hours);
        if (String(name ?? "").trim() && Number.isFinite(h) && h > 0) {
            out[String(name).trim()] = h;
        }
    }
    return out;
}

/**
 * Merged name → hours map (runtime wins over injected defaults per name).
 *
 * @param {object} [runtime] context.tasksRuntime
 * @returns {{ name: string, hours: number }[]}
 */
export function resolveRetentionNameRules(runtime = {}) {
    const merged = { ...(injectedDefaults ?? {}), ...parseRetentionNameRulesRaw(runtime.tasksRetentionNameRules) };
    return Object.entries(merged)
        .map(([name, hours]) => ({ name, hours: Number(hours) }))
        .filter((r) => r.name && Number.isFinite(r.hours) && r.hours > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
}
