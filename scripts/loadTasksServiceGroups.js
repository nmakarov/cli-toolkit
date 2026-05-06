import { readFileSync } from "node:fs";

function parseTasksServiceGroupsFile(configPath) {
    let raw;
    try {
        raw = readFileSync(configPath, "utf8");
    } catch (e) {
        throw new Error(`Cannot read tasks-by-service-group file "${configPath}": ${e?.message ?? String(e)}`);
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        throw new Error(`Invalid JSON in "${configPath}": ${e?.message ?? String(e)}`);
    }
}

/**
 * Load tasks + optional `maxInstances` for a service group from:
 * `{ "harvest": { "tasks": ["dummyHarvest"], "maxInstances": 4 }, ... }`
 */
export function loadServiceGroupEntryFromFile(configPath, serviceGroup) {
    const data = parseTasksServiceGroupsFile(configPath);
    const entry = data[serviceGroup];
    const tasks = entry?.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Error(
            `tasks-service-groups: missing or empty "tasks" for serviceGroup "${serviceGroup}" in "${configPath}"`
        );
    }
    const out = tasks.map((t) => String(t).trim()).filter(Boolean);
    if (out.length === 0) {
        throw new Error(`tasks-service-groups: no non-empty task names for "${serviceGroup}" in "${configPath}"`);
    }

    let maxInstances;
    const rawMax = entry?.maxInstances;
    if (rawMax !== undefined && rawMax !== null) {
        const n = Number(rawMax);
        if (!Number.isFinite(n) || n < 0) {
            throw new Error(
                `tasks-service-groups: "maxInstances" for "${serviceGroup}" must be a non-negative number in "${configPath}"`
            );
        }
        maxInstances = Math.floor(n);
    }

    return { tasks: out, maxInstances };
}

/**
 * Load `tasks` for a service group from a JSON file shaped as:
 * `{ "harvest": { "tasks": ["dummyHarvest", ...] }, ... }`
 */
export function loadTasksForServiceGroupFromFile(configPath, serviceGroup) {
    return loadServiceGroupEntryFromFile(configPath, serviceGroup).tasks;
}
