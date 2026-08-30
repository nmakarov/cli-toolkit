import os from "node:os";
import { toJsonColumn } from "../utils/index.js";
import { queueToTableNames } from "./taskUtils.js";

/**
 * Fail-fast accessor for `context.db`. The services-registry never lazy-inits the DB;
 * if it's missing, that's a caller wiring mistake.
 *
 * @param {object} context
 * @returns {Function}
 */
function getDb(context) {
    const db = context.db;
    if (!db) {
        throw new Error("Services registry requires context.db");
    }
    return db;
}

/**
 * Decode a JSON column value into a plain object. Returns `{}` for nulls,
 * arrays, parse errors — callers never get `null`/`undefined` back so they can
 * safely spread the result.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function parseMetadataColumn(value) {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value === "string") {
        try {
            const p = JSON.parse(value);
            return p && typeof p === "object" && !Array.isArray(value) ? p : {};
        } catch {
            return {};
        }
    }
    return {};
}

/**
 * Per-group max alive instances (0 = unlimited). Empty by default — product
 * apps inject their map via {@link setGroupMaxInstancesDefaults}.
 * An explicit `runnerGroupMaxInstances` override still wins.
 *
 * @type {Record<string, number>}
 */
let groupMaxInstancesDefaults = Object.create(null);

/**
 * Replace the per-group instance-cap map. Keys are lowercased group names.
 * Pass `null` / omit to clear (every group unlimited unless overridden).
 *
 * @param {Record<string, number>|null|undefined} map
 */
export function setGroupMaxInstancesDefaults(map) {
    const next = Object.create(null);
    if (map && typeof map === "object") {
        for (const [key, value] of Object.entries(map)) {
            const g = String(key).trim().toLowerCase();
            if (!g || !Number.isFinite(Number(value))) continue;
            next[g] = Math.max(0, Math.floor(Number(value)));
        }
    }
    groupMaxInstancesDefaults = next;
}

/**
 * Produce a DB-safe, human-readable name part: letters / digits / `._-` only,
 * trimmed and capped at 80 chars. Empty inputs fall back to `"runner"`.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function sanitizeNamePart(raw) {
    const s = String(raw || "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return s.slice(0, 80) || "runner";
}

/**
 * How many alive instances are allowed in this group? Explicit `override` wins;
 * otherwise use the per-group default (lowercased group name). `0` = unlimited.
 *
 * @param {string} serviceGroup
 * @param {number|undefined} override
 * @returns {number}
 */
function resolveMaxInstances(serviceGroup, override) {
    if (override !== undefined && Number.isFinite(override)) {
        return Math.max(0, Math.floor(Number(override)));
    }
    const g = serviceGroup.trim().toLowerCase();
    return groupMaxInstancesDefaults[g] ?? 0;
}

/** @internal exported for tests */
export function resolveGroupMaxInstances(serviceGroup, override) {
    return resolveMaxInstances(serviceGroup, override);
}

/**
 * Count rows in a group that have heartbeat'd within `staleMs`. Used to gate
 * `groupMaxInstances` at registration time.
 *
 * @param {Function} db knex instance.
 * @param {string} registryTable
 * @param {string} queueName
 * @param {string} serviceGroup
 * @param {number} staleMs
 * @param {string|undefined} excludeRowId When retrying, skip the row we're about to reuse.
 * @returns {Promise<number>}
 */
async function countAliveInGroup(
    db,
    registryTable,
    queueName,
    serviceGroup,
    staleMs,
    excludeRowId
) {
    const cutoff = new Date(Date.now() - staleMs);
    let q = db(registryTable)
        .where({ queue_name: queueName, service_group: serviceGroup })
        .where("last_seen_at", ">", cutoff);
    if (excludeRowId) {
        q = q.whereNot("id", excludeRowId);
    }
    const row = await q.count("id as count").first();
    return Number(row?.count ?? 0);
}

/**
 * Instance numbers currently held by *alive* rows (fresh last_seen).
 *
 * @param {Function} db
 * @param {string} registryTable
 * @param {string} queueName
 * @param {string} serviceGroup
 * @param {number} staleMs
 * @returns {Promise<Set<number>>}
 */
async function getOccupiedInstanceSlots(
    db,
    registryTable,
    queueName,
    serviceGroup,
    staleMs
) {
    const cutoff = new Date(Date.now() - staleMs);
    const rows = await db(registryTable)
        .where({ queue_name: queueName, service_group: serviceGroup })
        .where("last_seen_at", ">", cutoff)
        .select("instance_number");
    const set = new Set();
    for (const r of rows) {
        const n = Number(r.instance_number);
        if (Number.isFinite(n) && n >= 1) set.add(Math.floor(n));
    }
    return set;
}

/**
 * Best-effort detection of Postgres unique-constraint violations. Covers both
 * pg's `23505` SQLSTATE and drivers that only surface the error message.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isUniqueViolation(error) {
    const code = error?.code ?? error?.errno;
    return code === "23505" || String(error?.message || "").includes("duplicate key");
}

/**
 * Package the `metadata` JSON column payload for a new/updated registry row.
 * Always carries `runnerTarget` when provided so read-side filters can see it
 * without decoding the whole blob.
 *
 * @param {{ metadata?: Record<string, unknown>, target?: string }} options
 * @returns {string|null}
 */
function buildMetadata(options) {
    const base = options.metadata && typeof options.metadata === "object" ? { ...options.metadata } : {};
    if (options.target) {
        base.runnerTarget = options.target;
    }
    return toJsonColumn(Object.keys(base).length ? base : null);
}

/**
 * Pick first free instance number: smallest n >= 1 with n ∉ occupied.
 * If explicit is set, use it only if not in occupied and within maxSlots (when > 0).
 *
 * @param {Set<number>} occupied
 * @param {number|undefined|null} explicit
 * @param {number|undefined} maxSlots
 * @returns {number}
 */
function allocateInstanceNumber(occupied, explicit, maxSlots) {
    if (explicit !== undefined && explicit !== null && Number.isFinite(Number(explicit))) {
        const e = Math.max(1, Math.floor(Number(explicit)));
        if (occupied.has(e)) {
            throw new Error(`[services-registry] instance slot ${e} is already occupied by an alive peer`);
        }
        if (maxSlots !== undefined && maxSlots > 0 && e > maxSlots) {
            throw new Error(`[services-registry] instance ${e} exceeds configured max slots ${maxSlots} for this group`);
        }
        return e;
    }
    const cap = maxSlots !== undefined && maxSlots > 0 ? maxSlots : 10_000;
    for (let n = 1; n <= cap; n++) {
        if (!occupied.has(n)) return n;
    }
    throw new Error(`[services-registry] no free instance slot (searched 1..${cap})`);
}

/**
 * Build a conventional `service_name` when the caller didn't pick one:
 * `<group>-<host>-<instance>`.
 *
 * @param {string} groupBase
 * @param {string} hostBase
 * @param {number} instanceNumber
 * @returns {string}
 */
function defaultServiceName(groupBase, hostBase, instanceNumber) {
    return `${groupBase}-${hostBase}-${instanceNumber}`;
}

/**
 * Register this process in `{queue}_services_registry` (no local identity files).
 * Allocates the first free instance number among *alive* peers, then inserts or takes over a stale row
 * with the same `service_name` when restarting on the same host/name pattern.
 *
 * @param {object} context
 * @param {{
 *   queueName: string,
 *   target?: string,
 *   serviceGroup: string,
 *   serviceName?: string,
 *   instanceNumber?: number|null,
 *   staleMs: number,
 *   groupMaxInstances?: number,
 *   enforceMaxInstances?: boolean,
 *   metadata?: Record<string, unknown>,
 * }} options
 * @returns {Promise<{
 *   serviceName: string,
 *   serviceGroup: string,
 *   queueName: string,
 *   target?: string,
 *   rowId: string,
 *   registryTable: string,
 *   instanceNumber: number,
 * }>}
 */
export async function registerInServicesRegistry(context, options) {
    const db = getDb(context);
    const registryTable = queueToTableNames(options.queueName).registryTable;
    const serviceGroup = options.serviceGroup.trim();
    if (!serviceGroup) {
        throw new Error("registerInServicesRegistry: serviceGroup is required");
    }

    const serverName = os.hostname();
    const pid = typeof process.pid === "number" ? process.pid : null;
    const meta = buildMetadata(options);
    const groupBase = sanitizeNamePart(serviceGroup);
    const hostBase = sanitizeNamePart(serverName);

    const maxAllowed = resolveMaxInstances(serviceGroup, options.groupMaxInstances);
    const aliveCount = await countAliveInGroup(db, registryTable, options.queueName, serviceGroup, options.staleMs, undefined);

    if (maxAllowed > 0 && aliveCount >= maxAllowed) {
        const msg = `[services-registry] group limit reached for "${serviceGroup}": ${aliveCount} alive (max ${maxAllowed}, queue=${options.queueName}).`;
        if (options.enforceMaxInstances) {
            throw new Error(msg);
        }
        context.logger.warn?.(`${msg} Starting anyway (runnerEnforceMaxInstances=false).`);
    }

    const maxSlots = maxAllowed > 0 ? maxAllowed : undefined;
    const cutoff = new Date(Date.now() - options.staleMs);

    const MAX_ATTEMPTS = 8;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const occupied = await getOccupiedInstanceSlots(db, registryTable, options.queueName, serviceGroup, options.staleMs);
        const instanceNumber = allocateInstanceNumber(occupied, options.instanceNumber, maxSlots);

        const serviceNameRaw = options.serviceName?.trim()
            ? sanitizeNamePart(options.serviceName.trim())
            : defaultServiceName(groupBase, hostBase, instanceNumber);

        const existing = await db(registryTable)
            .where({ queue_name: options.queueName, service_name: serviceNameRaw })
            .first();

        if (existing) {
            const lastSeen = new Date(existing.last_seen_at);
            const isAlive = !Number.isNaN(lastSeen.getTime()) && lastSeen > cutoff;

            if (isAlive) {
                if (options.serviceName?.trim()) {
                    throw new Error(
                        `[services-registry] service_name "${serviceNameRaw}" is already registered by an alive peer`
                    );
                }
                context.logger.warn?.(
                    `[services-registry] service_name "${serviceNameRaw}" already alive; retrying allocation (attempt ${attempt + 1})`
                );
                if (options.instanceNumber !== undefined && options.instanceNumber !== null) {
                    throw new Error(
                        `[services-registry] instance slot ${instanceNumber} / name "${serviceNameRaw}" is already held by an alive peer`
                    );
                }
                await new Promise((r) => setTimeout(r, 50 + attempt * 30));
                continue;
            }

            await db(registryTable)
                .where({ id: existing.id })
                .update({
                    server_name: serverName,
                    pid,
                    metadata: meta,
                    service_group: serviceGroup,
                    instance_number: instanceNumber,
                    last_seen_at: db.fn.now(),
                });

            const reg = {
                serviceName: serviceNameRaw,
                serviceGroup,
                queueName: options.queueName,
                target: options.target,
                rowId: String(existing.id),
                registryTable,
                instanceNumber,
            };
            context.servicesRegistry = reg;
            context.runnerHeartbeat = reg;

            context.logger.info?.(
                `[services-registry] took over stale row name=${serviceNameRaw} instance=${instanceNumber} group=${serviceGroup} queue=${options.queueName}`
            );
            return reg;
        }

        try {
            const rows = await db(registryTable)
                .insert({
                    queue_name: options.queueName,
                    service_group: serviceGroup,
                    instance_number: instanceNumber,
                    service_name: serviceNameRaw,
                    server_name: serverName,
                    pid,
                    metadata: meta,
                    last_seen_at: db.fn.now(),
                    created_at: db.fn.now(),
                })
                .returning(["id", "service_name"]);

            const row = Array.isArray(rows) ? rows[0] : rows;
            let rowId = row && typeof row === "object" ? String(row.id ?? "") : "";
            if (!rowId) {
                const again = await db(registryTable)
                    .where({ queue_name: options.queueName, service_name: serviceNameRaw })
                    .first();
                rowId = again?.id != null ? String(again.id) : "";
            }
            if (!rowId) continue;

            const regNew = {
                serviceName: String(row?.service_name ?? serviceNameRaw),
                serviceGroup,
                queueName: options.queueName,
                target: options.target,
                rowId,
                registryTable,
                instanceNumber,
            };
            context.servicesRegistry = regNew;
            context.runnerHeartbeat = regNew;

            context.logger.info?.(
                `[services-registry] registered name=${regNew.serviceName} instance=${instanceNumber} group=${serviceGroup} queue=${options.queueName}`
            );
            return regNew;
        } catch (error) {
            if (!isUniqueViolation(error)) {
                throw error;
            }
            context.logger.warn?.(`[services-registry] insert race on "${serviceNameRaw}", retrying (attempt ${attempt + 1})`);
        }
    }

    throw new Error(
        `[services-registry] could not allocate a registry row for group=${serviceGroup} queue=${options.queueName} after ${MAX_ATTEMPTS} attempts`
    );
}

/**
 * Heartbeat: bump `last_seen_at`, refresh `server_name` / `pid` in case the
 * hostname rotates or the process PID changes (container restart in place).
 *
 * @param {object} context
 * @param {{ registryTable: string, rowId: string }} registration
 * @returns {Promise<void>}
 */
export async function touchServicesRegistry(context, registration) {
    const db = getDb(context);
    const serverName = os.hostname();
    const pid = typeof process.pid === "number" ? process.pid : null;
    await db(registration.registryTable)
        .where({ id: registration.rowId })
        .update({
            last_seen_at: db.fn.now(),
            server_name: serverName,
            pid,
        });
}

/**
 * Merge metadata (e.g. new allowedTasks / role) for this service row. Bumps last_seen_at.
 * Use when a service changes what it handles without restarting the process.
 *
 * @param {object} context
 * @param {{ registryTable: string, rowId: string, serviceName: string }} registration
 * @param {Record<string, unknown>} patch
 * @returns {Promise<void>}
 */
export async function updateServicesRegistryMetadata(context, registration, patch) {
    const db = getDb(context);
    const row = await db(registration.registryTable).where({ id: registration.rowId }).first();
    const prev = parseMetadataColumn(row?.metadata);
    const merged = { ...prev, ...patch };
    await db(registration.registryTable)
        .where({ id: registration.rowId })
        .update({
            metadata: toJsonColumn(merged),
            last_seen_at: db.fn.now(),
        });
    context.logger.info?.(`[services-registry] metadata updated for ${registration.serviceName}`);
}

/**
 * Drop this process's registry row. Call on graceful shutdown so peers don't
 * have to wait for `staleMs` to reclaim the slot.
 *
 * @param {object} context
 * @param {{ registryTable: string, rowId: string, serviceName: string }} registration
 * @returns {Promise<void>}
 */
export async function unregisterServicesRegistry(context, registration) {
    const db = getDb(context);
    await db(registration.registryTable).where({ id: registration.rowId }).delete();
    context.logger.info?.(`[services-registry] unregistered name=${registration.serviceName} id=${registration.rowId}`);
}

/**
 * List registry rows (optionally filter by queue / group). Rows with last_seen older than staleMs are excluded.
 *
 * @param {object} context
 * @param {{ queueName: string, staleMs?: number, serviceGroup?: string }} [options]
 * @returns {Promise<object[]>}
 */
export async function listServicesRegistry(context, options = { queueName: "tasks" }) {
    const db = getDb(context);
    const staleMs = options.staleMs ?? 60_000;
    const cutoff = new Date(Date.now() - staleMs);
    const table = queueToTableNames(options.queueName).registryTable;
    let q = db(table).where("last_seen_at", ">", cutoff).orderBy([{ column: "service_group", order: "asc" }, { column: "service_name", order: "asc" }]);
    if (options.serviceGroup?.trim()) {
        q = q.where({ service_group: options.serviceGroup.trim() });
    }
    return await q;
}
