import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { defineService } from "./service.js";

/**
 * Load a project's service manifests module. The module may export:
 *   export const services = { "my-svc": { … }, … }   // map
 *   export default { "my-svc": { … } }                // map as default
 *   export const services = [ { name: "my-svc", … } ] // array
 * Every entry is normalized through defineService().
 *
 * @param {{ manifests?: string, cwd?: string }} opts  manifests = path to the module
 * @returns {Promise<Record<string, object>>} name → normalized service
 */
export async function loadServices({ manifests = "deploy/services.js", cwd = process.cwd() } = {}) {
    const abs = isAbsolute(manifests) ? manifests : resolve(cwd, manifests);
    let mod;
    try {
        mod = await import(pathToFileURL(abs).href);
    } catch (err) {
        throw new Error(`Could not load deploy manifests from ${abs}: ${err.message}`);
    }

    const raw = mod.services ?? mod.default;
    if (!raw) {
        throw new Error(`Manifests module ${abs} must export \`services\` (or default): a map or array of service manifests`);
    }

    const list = Array.isArray(raw) ? raw : Object.values(raw);
    const out = {};
    for (const entry of list) {
        const svc = defineService(entry);
        out[svc.name] = svc;
    }
    return out;
}

/** Resolve one normalized service by name (optionally overriding appsRoot). */
export function resolveServiceFrom(serviceMap, name, { appsRoot } = {}) {
    const svc = serviceMap[name];
    if (!svc) {
        throw new Error(`Unknown service "${name}". Known: ${Object.keys(serviceMap).join(", ") || "(none)"}`);
    }
    return appsRoot ? { ...svc, appsRoot } : svc;
}
