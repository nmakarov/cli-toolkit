#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { ensureTaskTables, enqueueTask, queueToTableNames, waitForTaskResult } from "../../src/tasks/index.js";
import { timeMatcher } from "../../src/tasks/time-matcher.js";
import { showScreen, ListComponent, h } from "../../src/screen/index.js";

// npx tsx examples/tasks/task.ts --task=stop
// npx tsx examples/tasks/task.ts --task=sampleProcess --params=total:10 --params=delay:1000
// npx tsx examples/tasks/task.ts --task=sampleProcess --params="{total:50,delay:500,name:'demo'}"
// npx tsx examples/tasks/task.ts --task=taskSumAB --params="{a:1,b:2}"
// npx tsx examples/tasks/task.ts --task=taskSumAB --opid="import-2026-02-18-1" --params="{a:1,b:2}"
// npx tsx examples/tasks/task.ts --task=shellCommand --params="ls -la" --wait=true
// npx tsx examples/tasks/task.ts --task=shellCommand --params="command:'ls -la'" --wait=true
// npx tsx examples/tasks/task.ts --task=ping
// npx tsx examples/tasks/task.ts --task=systemInfo --wait=true
// npx tsx examples/tasks/task.ts --task=ping --schedule="*/5 * * * * *"
// npx tsx examples/tasks/task.ts --task=stopRunner
// npx tsx examples/tasks/task.ts --task=stop
// npx tsx examples/tasks/task.ts delete

function parseScalar(value) {
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
    if (/^null$/i.test(value)) return null;
    return value;
}

function parseTaskParams(paramsRaw) {
    if (!paramsRaw || !paramsRaw.trim()) return null;
    const raw = paramsRaw.trim();
    const candidates = [raw];
    if (!raw.startsWith("{") && !raw.startsWith("[") && raw.includes(":")) {
        candidates.push(`{${raw}}`);
    }

    let lastError = null;
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch (errorJson) {
            try {
                const fixed = candidate.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, "\"$1\":");
                return JSON.parse(fixed);
            } catch (errorFixed) {
                try {
                    const parsed = Function(`"use strict"; return (${candidate});`)();
                    if (parsed && typeof parsed === "object") {
                        return parsed ;
                    }
                    throw new Error("Parsed value is not an object");
                } catch (errorEval) {
                    lastError = `${errorJson.message}; ${errorFixed.message}; ${errorEval.message}`;
                }
            }
        }
    }
    throw new Error(`Invalid --params: expected JSON or json-like object. ${lastError}`);
}

function validateSchedule(schedule) {
    if (!schedule || !schedule.trim()) return null;
    const normalized = schedule.trim();
    try {
        timeMatcher(normalized, new Date());
        return normalized;
    } catch (error) {
        throw new Error(
            `Invalid --schedule="${normalized}". Expected 6 fields: sec min hour day month weekday. ${error.message}`
        );
    }
}

function parseExtraKeyValueTokens(tokens) {
    const out = {};
    for (const token of tokens) {
        const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(token);
        if (!m) continue;
        out[m[1]] = parseScalar(m[2]);
    }
    return out;
}

function formatTaskResults(taskName, results) {
    if (taskName === "shellCommand" && results && typeof results === "object") {
        const command = results.command ?? "";
        const cwd = results.cwd ?? "";
        const exitCode = results.exitCode ?? null;
        const signal = results.signal ?? null;
        const output = typeof results.output === "string" ? results.output : "";
        const stderr = typeof results.stderr === "string" ? results.stderr : "";

        const parts = [];
        parts.push(`command: ${command}`);
        parts.push(`cwd: ${cwd}`);
        parts.push(`exitCode: ${String(exitCode)}${signal ? ` signal: ${signal}` : ""}`);
        parts.push("stdout:");
        parts.push(output || "(empty)");
        if (stderr) {
            parts.push("stderr:");
            parts.push(stderr);
        }
        return parts.join("\n");
    }

    if (typeof results === "string") return results;
    if (results === undefined) return "undefined";
    return JSON.stringify(results, null, 2);
}

async function pickTaskForDelete(tasks) {
    if (tasks.length === 0) return null;
    const items = tasks.map((row) => ({
        name: `${row.task} [${row.id.slice(0, 8)}] target=${row.target}${row.schedule ? ` schedule=${row.schedule}` : ""}`,
        value: row.id,
    }));
    const result = await showScreen({
        title: "Tasks queue (press d to delete selected)",
        onRender: (ctx) => {
            const selectedIndexRef = { current: 0 };
            ctx.setAction("deleteSelected", () => {
                const selected = items[selectedIndexRef.current];
                ctx.close(selected?.value ?? null);
            });
            ctx.setKeyBinding({ key: "d", caption: "delete", action: "deleteSelected", order: 2 });
            return h(ListComponent, { items, ctx, selectedIndexRef });
        },
    });
    return typeof result === "string" ? result : null;
}

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    target: "string default localRunner",
    id: "string",
    opid: "string",
    task: "string",
    params: "string",
    priority: "number default 0",
    schedule: "string",
    wait: "boolean default false",
    waitMs: "number default 30000",
};

const flow = async (context) => {
    const { dbName, table, target, id, opid, task, params: paramsRaw, priority, schedule, wait, waitMs } = context.params.getAll(defs);
    const db = await dbInit(context, dbName);
    context.db = db;

    const commands = (context.args.getCommands?.() || []) ;
    const operation = (commands[0] || "create").toLowerCase();

    await ensureTaskTables(context, { queue: table, recreate: false });
    const { tasksTable } = queueToTableNames(table);

    if (operation === "create") {
        if (!task) {
            throw new Error(`--task is required for operation=create`);
        }

        const mergedParamsRaw = paramsRaw;
        const useShellShortcut =
            task === "shellCommand" &&
            typeof mergedParamsRaw === "string" &&
            mergedParamsRaw.trim().length > 0 &&
            !mergedParamsRaw.trim().startsWith("{") &&
            !mergedParamsRaw.trim().startsWith("[") &&
            !mergedParamsRaw.includes(":");
        const parsedParams = useShellShortcut
            ? { command: mergedParamsRaw.trim() }
            : (parseTaskParams(mergedParamsRaw) ?? {});
        const extraTokens = commands.slice(1);
        const extraParams = parseExtraKeyValueTokens(extraTokens);
        const taskParams = Object.keys(extraParams).length > 0
            ? { ...parsedParams, ...extraParams }
            : (Object.keys(parsedParams).length > 0 ? parsedParams : null);
        const normalizedSchedule = validateSchedule(schedule);

        const createdId = await enqueueTask(context, {
            queue: table,
            target,
            task,
            params: taskParams,
            opid: opid ?? null,
            priority,
            schedule: normalizedSchedule,
        });

        context.logger.info?.(
            `[task] created id=${createdId} opid=${opid ?? "none"} task=${task} target=${target} schedule=${normalizedSchedule ?? "none"} params=${JSON.stringify(taskParams)}`
        );

        if (!wait) return;

        const done = await waitForTaskResult(context, createdId, { queue: table, timeoutMs: waitMs });
        if (!done) {
            context.logger.warn?.(`[task] timeout after ${waitMs}ms waiting for id=${createdId}`);
            return;
        }
        const resultsText = formatTaskResults(task, done.results);
        context.logger.info?.(`[task] completed id=${createdId} success=${done.success}`);
        context.logger.info?.(`[task] results:\n${resultsText}`);
        return;
    }

    if (operation === "delete") {
        let deleteId = id || null;

        if (!deleteId && !task) {
            const rows = await db(tasksTable).select("*").orderBy([{ column: "priority", order: "desc" }, { column: "created_at", order: "asc" }]);
            deleteId = await pickTaskForDelete(rows);
            if (!deleteId) {
                context.logger.info?.("[task] delete cancelled");
                return;
            }
        }

        if (deleteId) {
            const removed = await db(tasksTable).where({ id: deleteId }).delete();
            context.logger.info?.(`[task] delete by id=${deleteId} removed=${removed}`);
            return;
        }

        const removed = await db(tasksTable).where({ task }).delete();
        context.logger.info?.(`[task] delete by task="${task}" removed=${removed}`);
        return;
    }

    if (operation === "pause" || operation === "resume") {
        context.logger.warn?.(`[task] operation "${operation}" is not implemented yet`);
        return;
    }

    throw new Error(`Unknown --operation="${operation}". Supported: create, delete, pause, resume`);
};

void init(flow);
