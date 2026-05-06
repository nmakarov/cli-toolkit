import { enqueueTask, queueToTableNames } from "./taskUtils.js";
import { waitForTaskResult } from "./index.js";

/**
 * Fail-fast accessor for `context.db`.
 *
 * @param {object} context
 * @returns {Function}
 */
function getDb(context) {
    const db = context.db;
    if (!db) {
        throw new Error("registryMaintenance requires context.db");
    }
    return db;
}

/**
 * For each row in `{queue}_services_registry` for this queue, enqueues a targeted `ping` and waits
 * for completion. If the ping does not finish within `pingTimeoutMs`, the registry row is deleted
 * and any matching `ping` tasks still on the queue (idle/running) for that service identity are removed.
 *
 * Useful as a periodic janitor: a runner that died mid-heartbeat won't remove itself from the registry,
 * and its pending pings will pile up until someone cleans both.
 *
 * @param {object} context
 * @param {{ queueName?: string, pingTimeoutMs?: number }} options
 * @returns {Promise<{ checked: number, removed: number, errors: string[] }>}
 */
export async function maintainRegistryLiveness(context, options) {
    const db = getDb(context);
    const queueName = options.queueName ?? "tasks";
    const pingTimeoutMs = options.pingTimeoutMs ?? 1000;
    const { tasksTable, registryTable } = queueToTableNames(queueName);

    const rows = await db(registryTable)
        .where({ queue_name: queueName })
        .orderBy([
            { column: "service_group", order: "asc" },
            { column: "instance_number", order: "asc" },
            { column: "service_name", order: "asc" },
        ]);

    let removed = 0;
    const errors = [];

    for (const r of rows) {
        let pingId = null;
        try {
            pingId = await enqueueTask(context, {
                queueName,
                name: "ping",
                priority: 0,
                serviceGroup: r.service_group,
                serviceName: r.service_name,
                instanceNumber: Math.max(
                    1,
                    Number.isFinite(Number(r.instance_number)) ? Math.floor(Number(r.instance_number)) : 1
                ),
                serverName: r.server_name,
            });

            const done = await waitForTaskResult(context, pingId, {
                queueName,
                timeoutMs: pingTimeoutMs,
                pollMs: 50,
            });

            if (done != null) {
                continue;
            }

            await db(registryTable).where({ id: r.id }).delete();

            await db(tasksTable)
                .where({ name: "ping" })
                .whereIn("status", ["idle", "running"])
                .where({ service_group: r.service_group })
                .where({ service_name: r.service_name })
                .where({ instance_number: r.instance_number })
                .where({ server_name: r.server_name })
                .delete();

            removed += 1;
        } catch (e) {
            const msg = e?.message ?? String(e);
            errors.push(`${r.service_name}: ${msg}`);
            if (pingId) {
                try {
                    await db(tasksTable).where({ id: pingId }).delete();
                } catch {
                    /* ignore */
                }
            }
        }
    }

    return { checked: rows.length, removed, errors };
}
