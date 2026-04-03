import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Context } from "../init/types.js";
import { toJsonColumn } from "../utils/index.js";
import { servicesRegistryTable } from "./taskUtils.js";

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
            return p && typeof p === "object" && !Array.isArray(p) ? p : {};
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
    loader: 0,
    photos: 0,
    photosprocessor: 0,
    ingest: 0,
};

export interface ServicesRegistryRegistration {
    instanceId: string;
    serviceName: string;
    serviceGroup: string;
    queue: string;
    target: string;
    rowId: string;
    registryTable: string;
}

export interface ServicesRegistryStartOptions {
    queue: string;
    target: string;
    serviceGroup: string;
    /** Explicit service name; otherwise derived from hostname / numbering. */
    serviceName?: string;
    identityDir: string;
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
    instance_id: string;
    queue: string;
    service_group: string;
    service_name: string;
    target: string;
    hostname: string | null;
    pid: number | null;
    metadata: any;
    created_at: Date | string;
    last_seen_at: Date | string;
};

type IdentityFile = {
    instanceId?: string;
    serviceName?: string;
};

function sanitizeNamePart(raw: string): string {
    const s = String(raw || "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return s.slice(0, 80) || "runner";
}

function identityFilePath(identityDir: string, queue: string, serviceGroup: string): string {
    const safeQ = sanitizeNamePart(queue);
    const safeG = sanitizeNamePart(serviceGroup);
    return path.join(identityDir, `${safeQ}_${safeG}.json`);
}

async function readIdentityFile(filePath: string): Promise<IdentityFile> {
    try {
        const text = await readFile(filePath, "utf8");
        const parsed = JSON.parse(text) as IdentityFile;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

async function writeIdentityFile(filePath: string, data: IdentityFile): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
    queue: string,
    serviceGroup: string,
    staleMs: number,
    excludeInstanceId?: string
): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs);
    let q = db(registryTable)
        .where({ queue, service_group: serviceGroup })
        .where("last_seen_at", ">", cutoff);
    if (excludeInstanceId) {
        q = q.whereNot("instance_id", excludeInstanceId);
    }
    const row = (await q.count("id as count").first()) as { count: string } | undefined;
    return Number(row?.count ?? 0);
}

function isUniqueViolation(error: any): boolean {
    const code = error?.code ?? error?.errno;
    return code === "23505" || String(error?.message || "").includes("duplicate key");
}

/**
 * Register this process in `{queue}_services_registry` (discovery, naming, optional group caps).
 * Call once at task-loop startup when runnerServiceGroup is set.
 */
export async function registerInServicesRegistry(context: Context, options: ServicesRegistryStartOptions): Promise<ServicesRegistryRegistration> {
    const db = getDb(context);
    const registryTable = servicesRegistryTable(options.queue);
    const serviceGroup = options.serviceGroup.trim();
    if (!serviceGroup) {
        throw new Error("registerInServicesRegistry: serviceGroup is required");
    }

    const identityPath = identityFilePath(options.identityDir, options.queue, serviceGroup);
    let identity = await readIdentityFile(identityPath);
    let instanceId = typeof identity.instanceId === "string" && identity.instanceId.trim() ? identity.instanceId.trim() : randomUUID();
    identity.instanceId = instanceId;
    await writeIdentityFile(identityPath, identity);

    const hostname = os.hostname();
    const pid = typeof process.pid === "number" ? process.pid : null;
    const meta = toJsonColumn(options.metadata ?? null);

    const existing = await db(registryTable).where({ instance_id: instanceId }).first();
    if (existing) {
        await db(registryTable)
            .where({ instance_id: instanceId })
            .update({
                target: options.target,
                hostname,
                pid,
                metadata: meta,
                last_seen_at: db.fn.now(),
            });
        const serviceName = String(existing.service_name);
        identity.serviceName = serviceName;
        await writeIdentityFile(identityPath, identity);

        const reg = {
            instanceId,
            serviceName,
            serviceGroup,
            queue: options.queue,
            target: options.target,
            rowId: String(existing.id),
        };
        (context as any).servicesRegistry = reg;
        (context as any).runnerHeartbeat = reg;

        context.logger.info?.(
            `[services-registry] resumed instance_id=${instanceId} name=${serviceName} group=${serviceGroup} queue=${options.queue}`
        );

        return {
            instanceId,
            serviceName,
            serviceGroup,
            queue: options.queue,
            target: options.target,
            rowId: String(existing.id),
            registryTable,
        };
    }

    const maxAllowed = resolveMaxInstances(serviceGroup, options.groupMaxInstances);
    const aliveOthers = await countAliveInGroup(
        db,
        registryTable,
        options.queue,
        serviceGroup,
        options.staleMs,
        instanceId
    );

    if (maxAllowed > 0 && aliveOthers >= maxAllowed) {
        const msg = `[services-registry] group limit reached for "${serviceGroup}": ${aliveOthers} alive (max ${maxAllowed}, queue=${options.queue}).`;
        if (options.enforceMaxInstances) {
            throw new Error(msg);
        }
        context.logger.warn?.(`${msg} Starting anyway (runnerEnforceMaxInstances=false).`);
    }

    const explicitName = options.serviceName?.trim();
    const fromFile = typeof identity.serviceName === "string" ? identity.serviceName.trim() : "";
    const hostBase = sanitizeNamePart(hostname);
    const groupBase = sanitizeNamePart(serviceGroup);

    const baseCandidates: string[] = [];
    if (explicitName) baseCandidates.push(sanitizeNamePart(explicitName));
    if (fromFile) baseCandidates.push(sanitizeNamePart(fromFile));
    baseCandidates.push(`${groupBase}-${hostBase}`);
    baseCandidates.push(groupBase);

    function* eachServiceNameCandidate(bases: string[]): Generator<string> {
        const seen = new Set<string>();
        for (const rawBase of bases) {
            const base = sanitizeNamePart(rawBase);
            if (!base) continue;
            const seq = [base];
            for (let n = 2; n <= 500; n++) seq.push(`${base}-${n}`);
            for (const c of seq) {
                if (seen.has(c)) continue;
                seen.add(c);
                yield c;
            }
        }
    }

    let inserted: { id: string; service_name: string } | undefined;
    for (const candidate of eachServiceNameCandidate(baseCandidates)) {
        try {
            const rows = await db(registryTable)
                .insert({
                    instance_id: instanceId,
                    queue: options.queue,
                    service_group: serviceGroup,
                    service_name: candidate,
                    target: options.target,
                    hostname,
                    pid,
                    metadata: meta,
                    last_seen_at: db.fn.now(),
                })
                .returning(["id", "service_name"]);
            const row = Array.isArray(rows) ? rows[0] : rows;
            if (row) {
                inserted = { id: String(row.id), service_name: String(row.service_name) };
                break;
            }
        } catch (error: any) {
            if (!isUniqueViolation(error)) {
                throw error;
            }
        }
    }

    if (!inserted) {
        throw new Error(
            `[services-registry] could not allocate a unique service_name for group=${serviceGroup} queue=${options.queue} (too many collisions).`
        );
    }

    identity.serviceName = inserted.service_name;
    await writeIdentityFile(identityPath, identity);

    const regNew = {
        instanceId,
        serviceName: inserted.service_name,
        serviceGroup,
        queue: options.queue,
        target: options.target,
        rowId: inserted.id,
    };
    (context as any).servicesRegistry = regNew;
    (context as any).runnerHeartbeat = regNew;

    context.logger.info?.(
        `[services-registry] registered instance_id=${instanceId} name=${inserted.service_name} group=${serviceGroup} queue=${options.queue} target=${options.target}`
    );

    return {
        instanceId,
        serviceName: inserted.service_name,
        serviceGroup,
        queue: options.queue,
        target: options.target,
        rowId: inserted.id,
        registryTable,
    };
}

export async function touchServicesRegistry(context: Context, registration: ServicesRegistryRegistration): Promise<void> {
    const db = getDb(context);
    const hostname = os.hostname();
    const pid = typeof process.pid === "number" ? process.pid : null;
    await db(registration.registryTable)
        .where({ instance_id: registration.instanceId })
        .update({
            last_seen_at: db.fn.now(),
            hostname,
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
    const row = await db(registration.registryTable).where({ instance_id: registration.instanceId }).first();
    const prev = parseMetadataColumn(row?.metadata);
    const merged = { ...prev, ...patch };
    await db(registration.registryTable)
        .where({ instance_id: registration.instanceId })
        .update({
            metadata: toJsonColumn(merged),
            last_seen_at: db.fn.now(),
        });
    context.logger.info?.(`[services-registry] metadata updated for ${registration.serviceName}`);
}

export async function unregisterServicesRegistry(context: Context, registration: ServicesRegistryRegistration): Promise<void> {
    const db = getDb(context);
    await db(registration.registryTable).where({ instance_id: registration.instanceId }).delete();
    context.logger.info?.(`[services-registry] unregistered name=${registration.serviceName} instance_id=${registration.instanceId}`);
}

/**
 * List registry rows (optionally filter by queue / group). Rows with last_seen older than staleMs are excluded.
 */
export async function listServicesRegistry(
    context: Context,
    options: { queue: string; serviceGroup?: string; staleMs?: number } = { queue: "tasks" }
): Promise<ServicesRegistryRow[]> {
    const db = getDb(context);
    const staleMs = options.staleMs ?? 60_000;
    const cutoff = new Date(Date.now() - staleMs);
    const table = servicesRegistryTable(options.queue);
    let q = db(table).where("last_seen_at", ">", cutoff).orderBy([{ column: "service_group", order: "asc" }, { column: "service_name", order: "asc" }]);
    if (options.serviceGroup?.trim()) {
        q = q.where({ service_group: options.serviceGroup.trim() });
    }
    return (await q) as ServicesRegistryRow[];
}
