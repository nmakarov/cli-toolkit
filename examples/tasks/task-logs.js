#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { FileDatabase } from "../../src/filedatabase/index.js";
import { FileDatabaseError } from "../../src/filedatabase/index.js";
import { Logger } from "../../src/logger/index.js";
import { showScreen, ListComponent, h } from "../../src/screen/index.js";

// npx tsx examples/tasks/task-logs.ts --mode=latestHarvest --source=armls --resource=properties
// npx tsx examples/tasks/task-logs.ts --mode=workflow --opid=op_123
// npx tsx examples/tasks/task-logs.ts --mode=errors

const defs = {
    mode: "string default latestHarvest",
    errorsOnly: "boolean default false",
    opid: "string",
    source: "string",
    resource: "string",
    limit: "number default 2000",
    tasksLogsBasePath: "string default ./data",
    tasksLogsNamespace: "string default tasks-logs",
    tasksLogsTable: "string default runner",
    tasksErrorLogsTable: "string default runner-errors",
    tasksLogsMaxVersions: "number default 20",
};






















function asArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return [value];
}

function messageOf(entry) {
    const payload = entry?.payload;
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    if (typeof payload?.message === "string") return payload.message;
    return "";
}

function toLoggerPayload(payload) {
    if (typeof payload === "string") {
        return { level: "info", message: payload };
    }
    if (!payload || typeof payload !== "object") {
        return { level: "info", message: String(payload ?? "") };
    }

    const levelRaw = typeof payload.level === "string" ? payload.level.toLowerCase() : "info";
    const level = levelRaw || "info";
    const out = {
        level,
        message: payload.message,
    };

    if (typeof payload.prefix === "string") out.prefix = payload.prefix;
    if (payload.count !== undefined) out.count = payload.count;
    if (payload.total !== undefined) out.total = Number(payload.total);
    if (payload.elapsed !== undefined) out.elapsed = Number(payload.elapsed);
    if (payload.remaining !== undefined) out.remaining = Number(payload.remaining);
    if (Array.isArray(payload.chunks)) out.chunks = payload.chunks;
    if (payload.results !== undefined) out.results = payload.results;

    // If message is missing, keep it readable instead of showing blank line.
    if (!out.message) {
        out.message = JSON.stringify(payload);
    }
    return out;
}

function formatEntryWithLogger(formatter, entry) {
    const payload = toLoggerPayload(entry.payload);
    const formatted = String((formatter ).formatLog(payload));
    return `${entry.ts || "-"} ${formatted}`;
}

function printEntries(entries, title, formatter) {
    console.log(`\n=== ${title} (${entries.length}) ===`);
    const byTask = new Map();
    for (const e of entries) {
        const key = e.taskName || "unknown";
        byTask.set(key, (byTask.get(key) || 0) + 1);
    }
    if (byTask.size) {
        const summary = Array.from(byTask.entries()).map(([task, count]) => `${task}:${count}`).join(", ");
        console.log(`tasks: ${summary}`);
    }
    for (const e of entries) {
        const header = `opid=${e.opid || "none"} task=${e.taskName || "unknown"}`;
        console.log(`${formatEntryWithLogger(formatter, e)} ${header}`);
    }
}

function hasErrorLevel(entry) {
    const level = typeof entry?.payload?.level === "string" ? entry.payload.level.toLowerCase() : "";
    return level === "error" || level === "fatal";
}

function toOneLineMessage(entry) {
    const text = messageOf(entry).replace(/\s+/g, " ").trim();
    if (!text) return "-";
    return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

async function pickErrorForTrace(entries) {
    if (!entries.length) return null;
    const withOpid = entries.filter((e) => typeof e.opid === "string" && !!e.opid?.trim());
    if (!withOpid.length) return null;
    const items = withOpid.map((e, idx) => {
        const ts = e.ts || "-";
        const task = e.taskName || "unknown";
        const opid = e.opid || "none";
        return {
            name: `${String(idx + 1).padStart(3, " ")} | ${ts} | ${task} | opid=${opid} | ${toOneLineMessage(e)}`,
            value: e.opid || null,
        };
    });
    const picked = await showScreen({
        title: "Error logs (Enter = trace workflow by opid)",
        onRender: (ctx) => {
            const selectedIndexRef = { current: 0 };
            ctx.setAction("quit", () => ctx.close(null));
            ctx.setAction("traceSelected", () => {
                const selected = items[selectedIndexRef.current];
                ctx.close(selected?.value ?? null);
            });
            ctx.setKeyBinding([
                { key: "return", caption: "trace opid", action: "traceSelected", order: 1 },
                { key: "t", caption: "trace opid", action: "traceSelected", order: 1 },
                { key: "q", caption: "quit", action: "quit", order: 2 },
            ]);
            return h(ListComponent, { items, ctx, selectedIndexRef });
        },
    });
    return typeof picked === "string" && picked.trim() ? picked.trim() : null;
}

const flow = async (context) => {
    const {
        mode,
        errorsOnly,
        opid,
        source,
        resource,
        limit,
        tasksLogsBasePath,
        tasksLogsNamespace,
        tasksLogsTable,
        tasksErrorLogsTable,
        tasksLogsMaxVersions,
    } = context.params.getAll(defs);

    const formatter = new Logger(context, {
        mode: "text",
        route: "console",
        showLevel: true,
        timestamp: false,
        levels: ["silly", "debug", "logic", "info", "notice", "warn", "error", "results", "request", "response", "progress"],
    });

    const fileDb = new FileDatabase({
        basePath: tasksLogsBasePath,
        namespace: tasksLogsNamespace,
        tableName: tasksLogsTable,
        versioned: true,
        maxVersions: tasksLogsMaxVersions,
        useMetadata: true,
        logger: context.logger,
    });
    const errorFileDb = new FileDatabase({
        basePath: tasksLogsBasePath,
        namespace: tasksLogsNamespace,
        tableName: tasksErrorLogsTable,
        versioned: true,
        maxVersions: tasksLogsMaxVersions,
        useMetadata: true,
        logger: context.logger,
    });

    let data;
    try {
        data = await fileDb.read();
    } catch (error) {
        if (error instanceof FileDatabaseError && /No versions found/.test(error.message)) {
            context.logger.warn?.(
                `[task-logs] no persisted task logs found yet in ${tasksLogsBasePath}/${tasksLogsNamespace}/${tasksLogsTable}`
            );
            return;
        }
        throw error;
    }
    const entries = asArray(data) ;
    const recent = entries.slice(-Math.max(1, limit));

    let errorData = [];
    try {
        errorData = await errorFileDb.read();
    } catch (error) {
        if (!(error instanceof FileDatabaseError) || !/No versions found/.test(error.message)) {
            throw error;
        }
    }
    const errorEntries = asArray(errorData) ;
    const recentErrors = errorEntries.slice(-Math.max(1, limit));

    if (mode === "errors") {
        if (!recentErrors.length) {
            context.logger.warn?.("[task-logs] no persisted error logs found");
            return;
        }
        const opidToTrace = await pickErrorForTrace(recentErrors);
        if (!opidToTrace) {
            context.logger.info?.("[task-logs] error trace cancelled");
            return;
        }
        const workflow = entries
            .filter((e) => e.opid === opidToTrace)
            .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
        if (!workflow.length) {
            context.logger.warn?.(`[task-logs] no workflow entries found for selected opid=${opidToTrace}`);
            return;
        }
        printEntries(workflow, `workflow from selected error opid=${opidToTrace}`, formatter);
        return;
    }

    if (mode === "workflow") {
        if (!opid) throw new Error(`--opid is required for mode=workflow`);
        const filteredBase = errorsOnly
            ? recent.filter((e) => hasErrorLevel(e))
            : recent;
        const filtered = filteredBase
            .filter((e) => e.opid === opid)
            .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
        printEntries(filtered, `workflow opid=${opid}`, formatter);
        return;
    }

    if (mode === "latestHarvest") {
        if (!source || !resource) throw new Error(`--source and --resource are required for mode=latestHarvest`);
        const harvestEntries = recent.filter(
            (e) => e.taskName === "dummyHarvest" && e.source === source && e.resource === resource && e.opid
        );
        if (!harvestEntries.length) {
            context.logger.warn?.(`[task-logs] no harvest logs found for ${source}/${resource}`);
            return;
        }
        const latestOpid = harvestEntries[harvestEntries.length - 1].opid ;
        const workflowBase = errorsOnly
            ? recent.filter((e) => hasErrorLevel(e))
            : recent;
        const workflow = workflowBase
            .filter((e) => e.opid === latestOpid)
            .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
        printEntries(workflow, `latestHarvest ${source}/${resource} opid=${latestOpid}`, formatter);
        return;
    }

    throw new Error(`Unknown --mode="${mode}". Supported: latestHarvest, workflow, errors`);
};

void init(flow);
