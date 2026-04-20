import { readFileSync } from "node:fs";

/** One service group block in `tasks-service-groups.json`. */
export type ServiceGroupConfigEntry = {
    tasks?: string[];
    /** Max concurrent alive workers for this group in `{queue}_services_registry` (0 = unlimited). Overrides code defaults when set. */
    maxInstances?: number;
};

export type TasksByServiceGroupFile = Record<string, ServiceGroupConfigEntry | undefined>;

export type ServiceGroupEntryLoaded = {
    tasks: string[];
    /** From JSON `maxInstances` when present; otherwise undefined (registry uses built-in defaults). */
    maxInstances?: number;
};

function parseTasksServiceGroupsFile(configPath: string): TasksByServiceGroupFile {
    let raw: string;
    try {
        raw = readFileSync(configPath, "utf8");
    } catch (e: any) {
        throw new Error(`Cannot read tasks-by-service-group file "${configPath}": ${e?.message ?? String(e)}`);
    }
    try {
        return JSON.parse(raw) as TasksByServiceGroupFile;
    } catch (e: any) {
        throw new Error(`Invalid JSON in "${configPath}": ${e?.message ?? String(e)}`);
    }
}

/**
 * Load tasks + optional `maxInstances` for a service group from:
 * `{ "harvest": { "tasks": ["dummyHarvest"], "maxInstances": 4 }, ... }`
 */
export function loadServiceGroupEntryFromFile(configPath: string, serviceGroup: string): ServiceGroupEntryLoaded {
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

    let maxInstances: number | undefined;
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
export function loadTasksForServiceGroupFromFile(configPath: string, serviceGroup: string): string[] {
    return loadServiceGroupEntryFromFile(configPath, serviceGroup).tasks;
}
