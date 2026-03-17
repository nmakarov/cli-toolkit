import type { Context } from "../../src/init/types.js";
import type { TaskRow } from "../../src/tasks/types.js";

type DbLike = any;

function getDb(context: Context): DbLike {
    const db = (context as any).db;
    if (!db) {
        throw new Error("dummy tasks require context.db");
    }
    return db;
}

export function getQueueTableName(context: Context): string {
    const fromParams = (context as any).params?.get?.("table");
    return typeof fromParams === "string" && fromParams.trim() ? fromParams.trim() : "tasks";
}

export async function countRunningTasksByName(
    context: Context,
    taskName: string,
    target?: string
): Promise<number> {
    const db = getDb(context);
    const table = getQueueTableName(context);
    let query = db(table)
        .where({ task: taskName })
        .whereNotNull("started_at")
        .count<{ count: string }>("id as count");
    if (target) {
        query = query.where({ target });
    }
    const row = await query.first();
    return Number(row?.count ?? 0);
}

export async function countRunningHarvestForSource(
    context: Context,
    task: TaskRow,
    source: string
): Promise<number> {
    const db = getDb(context);
    const table = getQueueTableName(context);
    const row = await db(table)
        .where({ task: "dummyHarvest" })
        .whereRaw("(params::json->>'source') = ?", [source])
        .whereNot("id", task.id)
        .whereNotNull("started_at")
        .count<{ count: string }>("id as count")
        .first();
    return Number(row?.count ?? 0);
}

export async function countUnfinishedLoadForPair(
    context: Context,
    source: string,
    resource: string
): Promise<number> {
    const db = getDb(context);
    const table = getQueueTableName(context);
    const row = await db(table)
        .where({ task: "dummyLoad" })
        .whereRaw("(params::json->>'source') = ?", [source])
        .whereRaw("(params::json->>'resource') = ?", [resource])
        .count<{ count: string }>("id as count")
        .first();
    return Number(row?.count ?? 0);
}

export async function ensureTaskOpid(context: Context, task: TaskRow, opid: string): Promise<void> {
    const db = getDb(context);
    const table = getQueueTableName(context);
    await db(table).where({ id: task.id }).update({ opid });
}

export function getNumberParam(context: Context, key: string, fallback: number): number {
    const raw = (context as any).params?.get?.(key);
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}
