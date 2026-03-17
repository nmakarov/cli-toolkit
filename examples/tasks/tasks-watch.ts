#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { queueToTableNames } from "../../src/tasks/index.js";
import { showScreen, Box, Text, h, useEffect, useState } from "../../src/screen/index.js";

// npx tsx examples/tasks/tasks-watch.ts --dbName=local --table=tasks --target=localRunner --pollMs=1000

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    target: "string",
    pollMs: "number default 1000",
};
const LOCKED_BY_ERROR_MESSAGE = "locked by error";

type TaskRowWatch = {
    id: string;
    task: string;
    params: any;
    started_at: string | Date | null;
    completed_at: string | Date | null;
    paused_at: string | Date | null;
    progress: string | null;
    success: boolean | null;
    created_at: string | Date;
};

function parseParams(params: any): Record<string, any> {
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

function normalizeProgress(progress: string | null | undefined): string {
    if (!progress) return "-";
    const oneLine = progress.replace(/\s+/g, " ").trim();
    return oneLine.length > 70 ? `${oneLine.slice(0, 67)}...` : oneLine;
}

function isLockedByErrorProgress(progress: string | null | undefined): boolean {
    if (typeof progress !== "string") return false;
    return progress.trim().toLowerCase() === LOCKED_BY_ERROR_MESSAGE;
}

function statusOf(row: TaskRowWatch): string {
    if (isLockedByErrorProgress(row.progress)) return "error";
    if (row.paused_at) return "paused";
    const running = !!row.started_at;
    if (!running && row.success === false) return "error";
    return running ? "running" : "idle";
}

function toRowLine(row: TaskRowWatch): string {
    const p = parseParams(row.params);
    const source = typeof p.source === "string" ? p.source : "-";
    const resource = typeof p.resource === "string" ? p.resource : "-";
    const status = statusOf(row);
    const progress = normalizeProgress(row.progress);
    return `${row.task.padEnd(14)} ${source.padEnd(8)} ${resource.padEnd(10)} ${status.padEnd(8)} ${progress}`;
}

function rowColorOf(row: TaskRowWatch): string {
    const status = statusOf(row);
    if (status === "error") return "red";
    if (status === "running") return "green";
    if (status === "paused") return "yellow";
    return "white";
}

const flow = async (context: any) => {
    const { dbName, table, target, pollMs } = context.params.getAll(defs);
    const db = await dbInit(context, dbName);
    context.db = db;
    const { tasksTable } = queueToTableNames(table);
    const dbCall = db as any;

    await showScreen({
        title: `Tasks Watch: ${tasksTable}${target ? ` (target=${target})` : ""}`,
        onRender: (ctx: any) => {
            ctx.setAction("quit", () => ctx.close(null));
            ctx.setAction("refresh", () => ctx.update());
            ctx.setKeyBinding([
                { key: "q", caption: "quit", action: "quit", order: 1 },
                { key: "r", caption: "refresh now", action: "refresh", order: 2 },
            ]);

            const WatchComponent = () => {
                const [rows, setRows] = useState<TaskRowWatch[]>([]);
                const [lastUpdated, setLastUpdated] = useState<string>("-");
                const [errorText, setErrorText] = useState<string>("");

                useEffect(() => {
                    let active = true;
                    const load = async () => {
                        try {
                            let query = dbCall(tasksTable)
                                .select("id", "task", "params", "started_at", "completed_at", "paused_at", "progress", "success", "created_at")
                                .orderBy([{ column: "created_at", order: "asc" }]);
                            if (target) {
                                query = query.where({ target });
                            }
                            const loaded = await query;
                            if (!active) return;
                            setRows(loaded as TaskRowWatch[]);
                            setLastUpdated(new Date().toISOString());
                            setErrorText("");
                        } catch (error: any) {
                            if (!active) return;
                            setErrorText(error?.message ?? String(error));
                        }
                    };

                    void load();
                    const timer = setInterval(() => {
                        void load();
                    }, Math.max(200, Number(pollMs) || 1000));

                    return () => {
                        active = false;
                        clearInterval(timer);
                    };
                }, []);

                const header = "task           source   resource   status   progress";
                const divider = "-".repeat(header.length);

                return h(Box, { flexDirection: "column" },
                    h(Text, {}, `rows: ${rows.length} | updated: ${lastUpdated}`),
                    errorText ? h(Text, { color: "red" }, `error: ${errorText}`) : h(Text, {}, ""),
                    h(Text, { color: "cyan" }, header),
                    h(Text, { color: "gray" }, divider),
                    ...rows.map((row) => h(Text, { key: row.id, color: rowColorOf(row) }, toRowLine(row)))
                );
            };

            return h(WatchComponent, {});
        },
    });
};

void init(flow);
