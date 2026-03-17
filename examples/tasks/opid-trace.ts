#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { queueToTableNames } from "../../src/tasks/index.js";
import { showScreen, ListComponent, h } from "../../src/screen/index.js";

// npx tsx examples/tasks/opid-trace.ts --opid="op_abc123" --table=tasks
// npx tsx examples/tasks/opid-trace.ts --table=tasks

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    opid: "string",
    limit: "number default 200",
    includeQueue: "boolean default true",
    includeHistory: "boolean default true",
};

function toJsonPretty(value: any): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
}

function fmtDate(value: any): string {
    if (!value) return "-";
    try {
        return new Date(value).toISOString();
    } catch {
        return String(value);
    }
}

function printRows(label: string, rows: any[]): void {
    // Keep this output human-oriented for quick operation-chain inspection.
    console.log(`\n=== ${label} (${rows.length}) ===`);
    if (rows.length === 0) {
        console.log("(none)");
        return;
    }

    rows.forEach((row, idx) => {
        console.log(
            `\n[${idx + 1}] id=${row.id} task=${row.task} target=${row.target} success=${String(row.success)} priority=${row.priority}`
        );
        console.log(
            `    created=${fmtDate(row.created_at)} started=${fmtDate(row.started_at)} completed=${fmtDate(row.completed_at)}`
        );
        if (row.schedule) console.log(`    schedule=${row.schedule}`);
        if (row.past_due) console.log(`    past_due=${fmtDate(row.past_due)}`);
        if (row.progress) console.log(`    progress=${row.progress}`);
        if (row.params !== undefined) {
            console.log(`    params=${toJsonPretty(row.params)}`);
        }
        if (row.results !== undefined) {
            console.log(`    results=${toJsonPretty(row.results)}`);
        }
    });
}

async function pickOpidForTrace(opids: string[]): Promise<string | null> {
    if (opids.length === 0) return null;
    const items = opids.map((value) => ({ name: value, value }));
    const result = await showScreen({
        title: "Select OPID (press t to trace selected)",
        onRender: (ctx: any) => {
            const selectedIndexRef = { current: 0 };
            ctx.setAction("traceSelected", () => {
                const selected = items[selectedIndexRef.current];
                ctx.close(selected?.value ?? null);
            });
            ctx.setKeyBinding({ key: "t", caption: "trace", action: "traceSelected", order: 2 });
            return h(ListComponent, { items, ctx, selectedIndexRef });
        },
    });
    return typeof result === "string" ? result : null;
}

const flow = async (context: any) => {
    const {
        dbName,
        table,
        opid,
        limit,
        includeQueue,
        includeHistory,
    } = context.params.getAll(defs);

    const db = await dbInit(context, dbName);
    context.db = db;

    const { tasksTable, historyTable } = queueToTableNames(table);
    let selectedOpid = typeof opid === "string" && opid.trim() ? opid.trim() : "";
    if (!selectedOpid) {
        const discovered = new Set<string>();
        if (includeQueue) {
            const queueOpids = await db(tasksTable)
                .select("opid")
                .whereNotNull("opid")
                .orderBy("created_at", "desc")
                .limit(1000);
            for (const row of queueOpids) {
                if (typeof row.opid === "string" && row.opid.trim()) discovered.add(row.opid.trim());
            }
        }
        if (includeHistory) {
            const historyOpids = await db(historyTable)
                .select("opid")
                .whereNotNull("opid")
                .orderBy("created_at", "desc")
                .limit(1000);
            for (const row of historyOpids) {
                if (typeof row.opid === "string" && row.opid.trim()) discovered.add(row.opid.trim());
            }
        }

        const opids = Array.from(discovered).sort();
        if (opids.length === 0) {
            context.logger.warn?.("[opid-trace] no opids found");
            return;
        }
        const picked = await pickOpidForTrace(opids);
        if (!picked) {
            context.logger.info?.("[opid-trace] trace cancelled");
            return;
        }
        selectedOpid = picked;
    }

    context.logger.info?.(`[opid-trace] opid=${selectedOpid} table=${table} limit=${limit}`);

    const queueRows = includeQueue
        ? await db(tasksTable)
            .where({ opid: selectedOpid })
            .orderBy([{ column: "created_at", order: "asc" }, { column: "priority", order: "desc" }])
            .limit(limit)
        : [];

    const historyRows = includeHistory
        ? await db(historyTable)
            .where({ opid: selectedOpid })
            .orderBy([{ column: "created_at", order: "asc" }, { column: "completed_at", order: "asc" }])
            .limit(limit)
        : [];

    if (!queueRows.length && !historyRows.length) {
        context.logger.warn?.(`[opid-trace] no rows found for opid=${selectedOpid}`);
        return;
    }

    printRows(tasksTable, queueRows);
    printRows(historyTable, historyRows);
};

void init(flow);
