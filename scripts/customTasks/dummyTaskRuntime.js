function getDb(context) {
    const db = context.db;
    return db != null ? db : null;
}

/** Queue table name (same as `queueName` in `enqueueTask`). */
export function getQueueTableName(context) {
    return String(context.tasksQueueName ?? "tasks");
}

/** Other `dummyHarvest` rows for this source currently running (excludes `idle` / `paused` claimants not yet running — only `running`). */
export async function countRunningHarvestForSource(context, _currentTask, source) {
    const db = getDb(context);
    if (!db) return 0;
    const t = getQueueTableName(context);
    const row = await db(t)
        .where({ name: "dummyHarvest", status: "running" })
        .whereRaw("(params::json->>'source') = ?", [source])
        .count("* as c")
        .first();
    return Number(row?.c ?? 0);
}

/** Pending or in-flight `dummyLoad` for the same source/resource (blocks new harvest until load finishes). */
export async function countUnfinishedLoadForPair(context, source, resource) {
    const db = getDb(context);
    if (!db) return 0;
    const t = getQueueTableName(context);
    const row = await db(t)
        .where({ name: "dummyLoad" })
        .whereIn("status", ["idle", "running"])
        .whereRaw("(params::json->>'source') = ?", [source])
        .whereRaw("(params::json->>'resource') = ?", [resource])
        .count("* as c")
        .first();
    return Number(row?.c ?? 0);
}

export async function ensureTaskOpid(context, task, opid) {
    const db = getDb(context);
    if (!db) return;
    const t = getQueueTableName(context);
    await db(t).where({ id: task.id }).update({ opid });
    task.opid = opid;
}
