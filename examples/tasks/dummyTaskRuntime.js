




function getDb(context) {
    const db = (context ).db;
    if (!db) {
        throw new Error("dummy tasks require context.db");
    }
    return db;
}

export function getQueueTableName(context) {
    const fromParams = (context ).params?.get?.("table");
    return typeof fromParams === "string" && fromParams.trim() ? fromParams.trim() : "tasks";
}

export async function countRunningTasksByName(
    context,
    taskName,
    target
) {
    const db = getDb(context);
    const table = getQueueTableName(context);
    let query = db(table)
        .where({ task: taskName })
        .whereNotNull("started_at")
        .count("id as count");
    if (target) {
        query = query.where({ target });
    }
    const row = await query.first();
    return Number(row?.count ?? 0);
}

export async function countRunningHarvestForSource(
    context,
    task,
    source
) {
    const db = getDb(context);
    const table = getQueueTableName(context);
    const row = await db(table)
        .where({ task: "dummyHarvest" })
        .whereRaw("(params::json->>'source') = ?", [source])
        .whereNot("id", task.id)
        .whereNotNull("started_at")
        .count("id as count")
        .first();
    return Number(row?.count ?? 0);
}

export async function countUnfinishedLoadForPair(
    context,
    source,
    resource
) {
    const db = getDb(context);
    const table = getQueueTableName(context);
    const row = await db(table)
        .where({ task: "dummyLoad" })
        .whereRaw("(params::json->>'source') = ?", [source])
        .whereRaw("(params::json->>'resource') = ?", [resource])
        .count("id as count")
        .first();
    return Number(row?.count ?? 0);
}

export async function ensureTaskOpid(context, task, opid) {
    const db = getDb(context);
    const table = getQueueTableName(context);
    await db(table).where({ id: task.id }).update({ opid });
}

export function getNumberParam(context, key, fallback) {
    const raw = (context ).params?.get?.(key);
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}
