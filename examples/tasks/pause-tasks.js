#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { queueToTableNames } from "../../src/tasks/index.js";
import { showScreen, ListComponent, h } from "../../src/screen/index.js";

// npx tsx examples/tasks/pause-tasks.ts --dbName=local --table=tasks

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    target: "string",
};











function readParamObject(params) {
    if (!params) return {};
    if (typeof params === "object") return params;
    if (typeof params === "string") {
        try {
            const parsed = JSON.parse(params);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function toIso(value) {
    if (!value) return "-";
    try {
        return new Date(value).toISOString();
    } catch {
        return String(value);
    }
}

function buildItemLabel(row) {
    const p = readParamObject(row.params);
    const source = typeof p.source === "string" ? p.source : "-";
    const resource = typeof p.resource === "string" ? p.resource : "-";
    const paused = row.paused_at ? "yes" : "no";
    return `${row.task} source=${source} resource=${resource} paused=${paused} target=${row.target} [${row.id.slice(0, 8)}]`;
}

async function pickAction(rows)





 {
    const items = rows.map((row) => ({
        name: buildItemLabel(row),
        value: row.id,
    }));

    const result = await showScreen({
        title: "Tasks pause manager (p=toggle, a=pause all, u=unpause all, q=quit)",
        onRender: (ctx) => {
            const selectedIndexRef = { current: 0 };
            ctx.setAction("toggleSelected", () => {
                const selected = rows[selectedIndexRef.current];
                if (!selected) {
                    ctx.close(null);
                    return;
                }
                ctx.close({
                    type: "toggle",
                    id: selected.id,
                    paused: !!selected.paused_at,
                });
            });
            ctx.setAction("pauseAll", () => ctx.close({ type: "pauseAll" }));
            ctx.setAction("unpauseAll", () => ctx.close({ type: "unpauseAll" }));
            ctx.setAction("quit", () => ctx.close({ type: "quit" }));
            ctx.setKeyBinding([
                { key: "p", caption: "toggle pause", action: "toggleSelected", order: 1 },
                { key: "a", caption: "pause all", action: "pauseAll", order: 2 },
                { key: "u", caption: "unpause all", action: "unpauseAll", order: 3 },
                { key: "q", caption: "quit", action: "quit", order: 4 },
            ]);
            return h(ListComponent, { items, ctx, selectedIndexRef });
        },
    });
    return result ?? null;
}

const flow = async (context) => {
    const { dbName, table, target } = context.params.getAll(defs);
    const db = await dbInit(context, dbName);
    const dbCall = db ;
    context.db = db;
    const { tasksTable } = queueToTableNames(table);

    while (true) {
        let query = dbCall(tasksTable)
            .select("id", "task", "target", "created_at", "paused_at", "progress", "params")
            .orderBy([{ column: "created_at", order: "asc" }]);
        if (target) {
            query = query.where({ target });
        }
        const rows = (await query) ;

        if (!rows.length) {
            context.logger.info?.(`[pause-tasks] no rows in table=${tasksTable}${target ? ` for target=${target}` : ""}`);
            return;
        }

        context.logger.info?.(
            `[pause-tasks] loaded ${rows.length} task(s); firstCreated=${toIso(rows[0].created_at)}`
        );
        const action = await pickAction(rows);
        if (!action || action.type === "quit") {
            context.logger.info?.("[pause-tasks] done");
            return;
        }

        if (action.type === "toggle") {
            if (action.paused) {
                const changed = await dbCall(tasksTable).where({ id: action.id }).update({ paused_at: null });
                context.logger.info?.(`[pause-tasks] unpaused id=${action.id} updated=${changed}`);
            } else {
                const changed = await dbCall(tasksTable).where({ id: action.id }).update({
                    paused_at: dbCall.fn.now(),
                    past_due: null,
                });
                context.logger.info?.(`[pause-tasks] paused id=${action.id} updated=${changed}`);
            }
            continue;
        }

        if (action.type === "pauseAll") {
            let q = dbCall(tasksTable).whereNull("paused_at");
            if (target) q = q.where({ target });
            const changed = await q.update({
                paused_at: dbCall.fn.now(),
                past_due: null,
            });
            context.logger.info?.(`[pause-tasks] paused all updated=${changed}`);
            continue;
        }

        if (action.type === "unpauseAll") {
            let q = dbCall(tasksTable).whereNotNull("paused_at");
            if (target) q = q.where({ target });
            const changed = await q.update({ paused_at: null });
            context.logger.info?.(`[pause-tasks] unpaused all updated=${changed}`);
            continue;
        }
    }
};

void init(flow);
