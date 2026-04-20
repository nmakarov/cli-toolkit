import os from "node:os";
import type { Context } from "../init/types.js";
import { toJsonColumn } from "../utils/index.js";
import { queueToTableNames } from "./taskUtils.js";

type DbLike = any;

function getDb(context: Context): DbLike {
    const db = (context as any).db;
    if (!db) {
        throw new Error("Services registry requires context.db");
    }
    return db;
}

function parseMetadataColumn(value: any): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
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

/** Default max concurrent *alive* services per group (0 = unlimited). Override with runnerGroupMaxInstances. */
const DEFAULT_GROUP_MAX_INSTANCES: Record<string, number> = {
    intake: 1,
    harvest: 1,
    harvester: 0,
    loader: 0,
    photos: 0,
    photosprocessor: 0,
    ingest: 0,
};

export interface ServicesRegistryRegistration {
    serviceName: string;
    serviceGroup: string;
    queueName: string;
    /** Echo of runTasksLoop target / routing hint (also stored in metadata as `runnerTarget` when set). */
    target?: string;
    rowId: string;
    registryTable: string;
    /** Instance slot allocated from the registry (first free among alive peers). */
    instanceNumber: number;
}

export interface ServicesRegistryStartOptions {
    queueName: string;
    /** Optional routing label stored in metadata (`runnerTarget`). */
    target?: string;
    serviceGroup: string;
    /** Optional fixed `service_name` (must be unique per queue). Default: `{group}-{hostname}-{instance}`. */
    serviceName?: string;
    /**
     * Optional explicit instance slot. Must not be occupied by an alive peer.
     * If omitted, the first free positive integer (among alive rows) is used.
     */
    instanceNumber?: number;
    /** Staleness window for "alive" peers (ms). */
    staleMs: number;
    /** Max instances for this group; 0 = unlimited. If unset, uses DEFAULT_GROUP_MAX_INSTANCES[group]. */
    groupMaxInstances?: number;
    /** If true (default), refuse to start when over limit. If false, only warn. */
    enforceMaxInstances: boolean;
    /** Stored in registry row metadata (JSON). Update later via updateServicesRegistryMetadata. */
    metadata?: Record<string, unknown> | null;
}

export type ServicesRegistryRow = {
    id: string;
    queue_name: string;
    service_group: string;
    instance_number: number;
    service_name: string;
    server_name: string;
    pid: number | null;
    metadata: any;
    created_at: Date | string;
    last_seen_at: Date | string;
};

function sanitizeNamePart(raw: string): string {
    const s = String(raw || "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return s.slice(0, 80) || "runner";
}

function resolveMaxInstances(serviceGroup: string, override?: number): number {
    if (override !== undefined && Number.isFinite(override)) {
        return Math.max(0, Math.floor(Number(override)));
    }
    const g = serviceGroup.trim().toLowerCase();
    return DEFAULT_GROUP_MAX_INSTANCES[g] ?? 0;
}

async function countAliveInGroup(
    db: DbLike,
    registryTable: string,
    queueName: string,
    serviceGroup: string,
    staleMs: number,
    excludeRowId?: string
): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs);
    let q = db(registryTable)
        .where({ queue_name: queueName, service_group: serviceGroup })
        .where("last_seen_at", ">", cutoff);
    if (excludeRowId) {
        q = q.whereNot("id", excludeRowId);
    }
    const row = (await q.count("id as count").first()) as { count: string } | undefined;
    return Number(row?.count ?? 0);
}

/** Instance numbers currently held by *alive* rows (fresh last_seen). */
async function getOccupiedInstanceSlots(
    db: DbLike,
    registryTable: string,
    queueName: string,
    serviceGroup: string,
    staleMs: number
): Promise<Set<number>> {
    const cutoff = new Date(Date.now() - staleMs);
    const rows = await db(registryTable)
        .where({ queue_name: queueName, service_group: serviceGroup })
        .where("last_seen_at", ">", cutoff)
        .select("instance_number");
    const set = new Set<number>();
    for (const r of rows as { instance_number: number }[]) {
        const n = Number(r.instance_number);
        if (Number.isFinite(n) && n >= 1) set.add(Math.floor(n));
    }
    return set;
}

function isUniqueViolation(error: any): boolean {
    const code = error?.code ?? error?.errno;
    return code === "23505" || String(error?.message || "").includes("duplicate key");
}

function buildMetadata(options: ServicesRegistryStartOptions): string | null {
    const base = options.metadata && typeof options.metadata === "object" ? { ...options.metadata } : {};
    if (options.target) {
        (base as Record<string, unknown>).runnerTarget = options.target;
    }
    return toJsonColumn(Object.keys(base).length ? base : null);
}

/**
 * Pick first free instance number: smallest n >= 1 with n ∉ occupied.
 * If explicit is set, use it only if not in occupied and within maxSlots (when > 0).
 */
function allocateInstanceNumber(
    occupied: Set<number>,
    explicit: number | undefined,
    maxSlots: number | undefined
): number {
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

function defaultServiceName(groupBase: string, hostBase: string, instanceNumber: number): string {
    return `${groupBase}-${hostBase}-${instanceNumber}`;
}

/**
 * Register this process in `{queue}_services_registry` (no local identity files).
 * Allocates the first free instance number among *alive* peers, then inserts or takes over a stale row
 * with the same `service_name` when restarting on the same host/name pattern.
 */
export async function registerInServicesRegistry(context: Context, options: ServicesRegistryStartOptions): Promise<ServicesRegistryRegistration> {
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
            const lastSeen = new Date(existing.last_seen_at as string | Date);
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

            const reg: ServicesRegistryRegistration = {
                serviceName: serviceNameRaw,
                serviceGroup,
                queueName: options.queueName,
                target: options.target,
                rowId: String(existing.id),
                registryTable,
                instanceNumber,
            };
            (context as any).servicesRegistry = reg;
            (context as any).runnerHeartbeat = reg;

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
            let rowId = row && typeof row === "object" ? String((row as any).id ?? "") : "";
            if (!rowId) {
                const again = await db(registryTable)
                    .where({ queue_name: options.queueName, service_name: serviceNameRaw })
                    .first();
                rowId = again?.id != null ? String(again.id) : "";
            }
            if (!rowId) continue;

            const regNew: ServicesRegistryRegistration = {
                serviceName: String((row as any)?.service_name ?? serviceNameRaw),
                serviceGroup,
                queueName: options.queueName,
                target: options.target,
                rowId,
                registryTable,
                instanceNumber,
            };
            (context as any).servicesRegistry = regNew;
            (context as any).runnerHeartbeat = regNew;

            context.logger.info?.(
                `[services-registry] registered name=${regNew.serviceName} instance=${instanceNumber} group=${serviceGroup} queue=${options.queueName}`
            );
            return regNew;
        } catch (error: any) {
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

export async function touchServicesRegistry(context: Context, registration: ServicesRegistryRegistration): Promise<void> {
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
 */
export async function updateServicesRegistryMetadata(
    context: Context,
    registration: ServicesRegistryRegistration,
    patch: Record<string, unknown>
): Promise<void> {
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

export async function unregisterServicesRegistry(context: Context, registration: ServicesRegistryRegistration): Promise<void> {
    const db = getDb(context);
    await db(registration.registryTable).where({ id: registration.rowId }).delete();
    context.logger.info?.(`[services-registry] unregistered name=${registration.serviceName} id=${registration.rowId}`);
}

/**
 * List registry rows (optionally filter by queue / group). Rows with last_seen older than staleMs are excluded.
 */
export async function listServicesRegistry(
    context: Context,
    options: { queueName: string; serviceGroup?: string; staleMs?: number } = { queueName: "tasks" }
): Promise<ServicesRegistryRow[]> {
    const db = getDb(context);
    const staleMs = options.staleMs ?? 60_000;
    const cutoff = new Date(Date.now() - staleMs);
    const table = queueToTableNames(options.queueName).registryTable;
    let q = db(table).where("last_seen_at", ">", cutoff).orderBy([{ column: "service_group", order: "asc" }, { column: "service_name", order: "asc" }]);
    if (options.serviceGroup?.trim()) {
        q = q.where({ service_group: options.serviceGroup.trim() });
    }
    return (await q) as ServicesRegistryRow[];
}
