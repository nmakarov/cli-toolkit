#!/usr/bin/env node
/**
 * Interactive TUI: pick Services (registry) or Tasks queue, then drill into a service to see running work.
 *
 * Example:
 *   npx tsx scripts/tasks-monitor.js --dbName=local --table=tasks --pollMs=1500
 *   npx tsx scripts/tasks-monitor.js --maintenanceIntervalMs=10000 --maintenancePingTimeoutMs=1000 --maintenanceRegistry=true
 * (maintenance runs in the script process, not inside a TUI screen.)
 */

import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { init } from "../src/init/index.js";
import { Db } from "../src/db/index.js";
import { enqueueTask, queueToTableNames, readTaskIpcLogsSnapshot, waitForTaskResult } from "../src/tasks/index.js";
import { maintainRegistryLiveness } from "../src/tasks/registryMaintenance.js";
import {
    showScreen,
    showListScreen,
    Box,
    Text,
    h,
    ListComponent,
    useEffect,
    useState,
    useRef,
    useMemo,
    useCallback,
    memo,
} from "../src/screen/index.js";

const defs = {
    table: "string default tasks",
    pollMs: "number default 1500",
    /** Optional: filter tasks view by service_group (same as runner target / task.service_group). */
    target: "string",
    /** Background registry ping / dead-row cleanup interval for the whole monitor process (default 10s). */
    maintenanceIntervalMs: "number default 10000",
    /** Max wait for each maintenance ping (default 1s). */
    maintenancePingTimeoutMs: "number default 1000",
    /** Enable registry ping / dead-row cleanup from the monitor (default true). */
    maintenanceRegistry: "boolean default true",
    /** Initial IPC log lines for dummyHarvest log viewer (`Enter`). */
    logTailInitial: "number default 120",
    /** Poll interval for log viewer (ms). */
    logTailPollMs: "number default 2000",
};

function taskParamsObject(row) {
    const p = row.params;
    if (p && typeof p === "string") {
        try {
            return JSON.parse(p);
        } catch {
            return {};
        }
    }
    if (p && typeof p === "object") return p;
    return {};
}

function parseTaskResults(results) {
    if (results == null) return null;
    if (typeof results === "string") {
        try {
            return JSON.parse(results);
        } catch {
            return null;
        }
    }
    if (typeof results === "object") return results;
    return null;
}

/**
 * Match task worker IPC progress shape (see logger `progress()` and taskScriptRunner `payloadToProgressText`).
 * Count is often a padded string (e.g. "  12") from the logger.
 */
function formatProgressPayloadForMonitor(pl) {
    const level = typeof pl.level === "string" ? pl.level.toLowerCase() : "";
    if (level !== "progress") return null;
    const countRaw = pl.count;
    const totalRaw = pl.total;
    if (countRaw == null || totalRaw == null) return null;
    const count = String(countRaw).trim();
    const total = String(totalRaw).trim();
    const pfx = typeof pl.prefix === "string" && pl.prefix.trim() ? `${String(pl.prefix).trim()} ` : "";
    if (typeof pl.message === "string" && pl.message.trim()) {
        return `${pfx}${pl.message} ${count}/${total}`;
    }
    return `${pfx}${count}/${total}`;
}

function formatLogRecordLine(rec) {
    const ts = typeof rec.ts === "string" ? rec.ts : "?";
    const pl = rec.payload;
    let msg = "";
    let lv = "";
    if (pl && typeof pl === "object") {
        const progressMsg = formatProgressPayloadForMonitor(pl);
        if (progressMsg != null) {
            msg = progressMsg;
            lv = typeof pl.level === "string" ? pl.level : "progress";
        } else if (typeof pl.message === "string") {
            msg = pl.message;
            if (typeof pl.level === "string") lv = pl.level;
        } else {
            msg = JSON.stringify(pl);
        }
    } else if (pl != null) {
        msg = String(pl);
    }
    const one = `${ts} ${lv} ${msg}`.replace(/\s+/g, " ").trim();
    const w = Math.max(40, (process.stdout.columns || 80) - 4);
    return one.length > w ? `${one.slice(0, w - 1)}…` : one;
}

/**
 * Read logs for a dummyHarvest row: local FileDatabase if `server_name` matches this host or is unset; otherwise enqueue `getLogs` targeted at `server_name`.
 */
async function fetchLogRecordsForMonitor(context, queueName, row, opts) {
    const ps = taskParamsObject(row);
    const source = String(ps.source ?? "").trim();
    const resource = String(ps.resource ?? "").trim();
    if (!source || !resource) {
        throw new Error("Task params need source and resource");
    }
    const serverName = row.server_name?.trim() || null;
    const host = os.hostname();

    if (!serverName || serverName === host) {
        return readTaskIpcLogsSnapshot(context, {
            source,
            resource,
            tail: opts.tail,
            afterTs: opts.afterTs,
        });
    }

    const opid = `gl_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const taskId = await enqueueTask(context, {
        queueName,
        name: "getLogs",
        opid,
        priority: 0,
        params: {
            source,
            resource,
            tail: opts.tail,
            afterTs: opts.afterTs,
        },
        serviceGroup: null,
        serviceName: null,
        instanceNumber: null,
        serverName,
    });

    const done = await waitForTaskResult(context, taskId, { queueName, timeoutMs: 60_000, pollMs: 400 });
    if (!done) {
        throw new Error("getLogs timed out");
    }
    const parsed = parseTaskResults(done.results);
    if (done.success === false) {
        throw new Error(String(parsed?.error ?? "getLogs failed"));
    }
    if (!parsed) {
        throw new Error("getLogs returned no results");
    }
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    const latestTs = typeof parsed.latestTs === "string" ? parsed.latestTs : null;
    return { records, latestTs };
}

function formatTs(v) {
    if (v == null) return "-";
    const d = typeof v === "string" ? new Date(v) : v;
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().replace("T", " ").slice(0, 19);
}

function oneLine(s, max = 64) {
    if (s == null || s === "") return "-";
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

const REG_GAP = 2;
const TASK_QUEUE_GAP = 2;

/** Matches ListComponent row prefix: arrow (2) + selectionMarker (1 default). */
const REGISTRY_LIST_ROW_PREFIX = "   ";

function padOrTruncateCell(s, w) {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length <= w) return t.padEnd(w);
    return w <= 1 ? "" : `${t.slice(0, Math.max(0, w - 1))}…`;
}

/** Tasks queue: time until `next_run_at`, or "past due" when `past_due` / overdue. */
function formatNextRunCell(row, now) {
    if (row.past_due != null) {
        return "past due";
    }
    const nr = row.next_run_at;
    if (nr == null) {
        return "-";
    }
    const t = typeof nr === "string" ? new Date(nr) : nr;
    if (Number.isNaN(t.getTime())) {
        return "-";
    }
    const ms = t.getTime() - now.getTime();
    if (ms <= 0) {
        return "past due";
    }
    const sec = Math.ceil(ms / 1000);
    if (sec < 60) {
        return `${sec}s`;
    }
    if (sec < 3600) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return s === 0 ? `${m}m` : `${m}m${s}s`;
    }
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function taskParamsSourceResourceDisplay(row) {
    const p = taskParamsObject(row);
    const source = String(p.source ?? "").trim();
    const resource = String(p.resource ?? "").trim();
    return {
        source: source || "-",
        resource: resource || "-",
    };
}

/**
 * @param peaks `svc` / `started` minimum widths from prior renders — columns only grow, never shrink below peaks when current data is narrower.
 */
function computeTasksQueueColumnWidths(rows, now, peaks) {
    const minName = 5;
    const minStatus = 6;
    const minSvc = 3;
    const minSource = 6;
    const minResource = 8;
    const minStarted = 8;
    const minNextRun = 8;
    const minProgress = 6;

    const name = Math.max(minName, "name".length, ...rows.map((r) => String(r.name ?? "").length));
    const status = Math.max(minStatus, "status".length, ...rows.map((r) => String(r.status ?? "").length));
    const naturalSvc = Math.max(minSvc, "svc".length, ...rows.map((r) => String(r.service_name ?? "").length));
    const source = Math.max(
        minSource,
        "source".length,
        ...rows.map((r) => taskParamsSourceResourceDisplay(r).source.length)
    );
    const resource = Math.max(
        minResource,
        "resource".length,
        ...rows.map((r) => taskParamsSourceResourceDisplay(r).resource.length)
    );
    const naturalStarted = Math.max(minStarted, "started".length, ...rows.map((r) => formatTs(r.started_at).length));
    const svc = Math.max(naturalSvc, peaks?.svc ?? 0);
    const started = Math.max(naturalStarted, peaks?.started ?? 0);
    const nextRun = Math.max(
        minNextRun,
        "next run".length,
        ...rows.map((r) => formatNextRunCell(r, now).length)
    );
    const progress = Math.max(
        minProgress,
        "progress".length,
        ...rows.map((r) => oneLine(r.progress, 1000).length)
    );

    const markerArrow = 4;
    const inner =
        name +
        TASK_QUEUE_GAP +
        status +
        TASK_QUEUE_GAP +
        svc +
        TASK_QUEUE_GAP +
        source +
        TASK_QUEUE_GAP +
        resource +
        TASK_QUEUE_GAP +
        started +
        TASK_QUEUE_GAP +
        nextRun +
        TASK_QUEUE_GAP +
        progress;
    const termW = Math.max(48, (process.stdout.columns || 80) - 6 - markerArrow);
    if (inner <= termW) {
        return { name, status, svc, source, resource, started, nextRun, progress };
    }

    const overflow = inner - termW;
    const name2 = Math.max(minName, name - Math.floor(overflow * 0.32));
    const progress2 = Math.max(minProgress, progress - Math.ceil(overflow * 0.33));
    const source2 = Math.max(minSource, source - Math.floor(overflow * 0.18));
    const resource2 = Math.max(minResource, resource - Math.ceil(overflow * 0.17));
    return { name: name2, status, svc, source: source2, resource: resource2, started, nextRun, progress: progress2 };
}

function formatTasksQueueTableLine(row, w, now) {
    const { source: src, resource: res } = taskParamsSourceResourceDisplay(row);
    const a = padOrTruncateCell(String(row.name ?? ""), w.name);
    const b = padOrTruncateCell(String(row.status ?? ""), w.status);
    const c = padOrTruncateCell(String(row.service_name ?? ""), w.svc);
    const cs = padOrTruncateCell(src, w.source);
    const cr = padOrTruncateCell(res, w.resource);
    const d = padOrTruncateCell(formatTs(row.started_at), w.started);
    const e = padOrTruncateCell(formatNextRunCell(row, now), w.nextRun);
    const f = padOrTruncateCell(oneLine(row.progress, w.progress), w.progress);
    return `${a}${" ".repeat(TASK_QUEUE_GAP)}${b}${" ".repeat(TASK_QUEUE_GAP)}${c}${" ".repeat(TASK_QUEUE_GAP)}${cs}${" ".repeat(TASK_QUEUE_GAP)}${cr}${" ".repeat(TASK_QUEUE_GAP)}${d}${" ".repeat(TASK_QUEUE_GAP)}${e}${" ".repeat(TASK_QUEUE_GAP)}${f}`;
}

function formatTasksQueueHeader(w) {
    return `${padOrTruncateCell("name", w.name)}${" ".repeat(TASK_QUEUE_GAP)}${padOrTruncateCell("status", w.status)}${" ".repeat(TASK_QUEUE_GAP)}${padOrTruncateCell("svc", w.svc)}${" ".repeat(TASK_QUEUE_GAP)}${padOrTruncateCell("source", w.source)}${" ".repeat(TASK_QUEUE_GAP)}${padOrTruncateCell("resource", w.resource)}${" ".repeat(TASK_QUEUE_GAP)}${padOrTruncateCell("started", w.started)}${" ".repeat(TASK_QUEUE_GAP)}${padOrTruncateCell("next run", w.nextRun)}${" ".repeat(TASK_QUEUE_GAP)}${padOrTruncateCell("progress", w.progress)}`;
}

/**
 * Count `tasks` rows in `running` status for this registry row.
 * Mirrors `claimNextRunnableTask`: each column matches if the task value is NULL (any runner) or equals the registry value.
 * Strict `IS NOT DISTINCT FROM` was wrong — enqueued tasks often have `service_group` (etc.) NULL while the registry has real values.
 */
async function countRunningTasksForRegistry(db, tasksTable, r) {
    const row = await db(tasksTable)
        .where({ status: "running" })
        .where(function () {
            this.whereNull("service_group").orWhere({ service_group: r.service_group });
        })
        .where(function () {
            this.whereNull("service_name").orWhere({ service_name: r.service_name });
        })
        .where(function () {
            this.whereNull("instance_number").orWhere({ instance_number: r.instance_number });
        })
        .where(function () {
            this.whereNull("server_name").orWhere({ server_name: r.server_name });
        })
        .count("* as count")
        .first();
    return Number(row?.count ?? 0);
}

/** Instance column: numeric instance + short row id (stable across similar service_name). */
function formatRegistryInstanceCell(r) {
    const n = r.instance_number != null && Number.isFinite(Number(r.instance_number)) ? String(r.instance_number) : "?";
    const raw = String(r.id ?? "").replace(/-/g, "");
    const short = raw.slice(0, 8);
    return short ? `${n} ${short}` : n;
}

/** Column widths for registry table (fits terminal; shrinks service_name if needed). */
function computeRegistryColumnWidths(rows) {
    const minG = 8;
    const minSn = 14;
    const minInst = 12;
    const minSrv = 8;
    const minRun = 3;
    const minPid = 5;
    const g = Math.max(minG, "group".length, ...rows.map((r) => String(r.service_group ?? "").length));
    const sn = Math.max(minSn, "service_name".length, ...rows.map((r) => String(r.service_name ?? "").length));
    const inst = Math.max(minInst, "instance".length, ...rows.map((r) => formatRegistryInstanceCell(r).length));
    const srv = Math.max(minSrv, "server".length, ...rows.map((r) => String(r.server_name ?? "").length));
    const run = Math.max(minRun, "running".length, ...rows.map((r) => String(r.runningCount ?? 0).length));
    const pid = Math.max(minPid, "pid".length, ...rows.map((r) => String(r.pid ?? "?").length));

    const markerArrow = 4;
    const inner = g + REG_GAP + sn + REG_GAP + inst + REG_GAP + srv + REG_GAP + run + REG_GAP + pid;
    const termW = Math.max(48, (process.stdout.columns || 80) - 6 - markerArrow);
    if (inner <= termW) return { g, sn, inst, srv, run, pid };

    const overflow = inner - termW;
    const sn2 = Math.max(minSn, sn - Math.floor(overflow * 0.55));
    const inst2 = Math.max(minInst, inst - Math.ceil(overflow * 0.45));
    return { g, sn: sn2, inst: inst2, srv, run, pid };
}

function formatRegistryTableLine(r, w) {
    const a = padOrTruncateCell(String(r.service_group ?? ""), w.g);
    const b = padOrTruncateCell(String(r.service_name ?? ""), w.sn);
    const i = padOrTruncateCell(formatRegistryInstanceCell(r), w.inst);
    const c = padOrTruncateCell(String(r.server_name ?? ""), w.srv);
    const rn = padOrTruncateCell(String(r.runningCount ?? 0), w.run);
    const d = padOrTruncateCell(String(r.pid ?? "?"), w.pid);
    return `${a}${" ".repeat(REG_GAP)}${b}${" ".repeat(REG_GAP)}${i}${" ".repeat(REG_GAP)}${c}${" ".repeat(REG_GAP)}${rn}${" ".repeat(REG_GAP)}${d}`;
}

function formatRegistryHeader(w) {
    return `${padOrTruncateCell("group", w.g)}${" ".repeat(REG_GAP)}${padOrTruncateCell("service_name", w.sn)}${" ".repeat(REG_GAP)}${padOrTruncateCell("instance", w.inst)}${" ".repeat(REG_GAP)}${padOrTruncateCell("server", w.srv)}${" ".repeat(REG_GAP)}${padOrTruncateCell("running", w.run)}${" ".repeat(REG_GAP)}${padOrTruncateCell("pid", w.pid)}`;
}

function historyGroupKey(g) {
    return `${g.name}\x1f${g.source}\x1f${g.resource}`;
}

function syntheticTaskRowForHistoryGroup(g) {
    const id = `hg_${createHash("sha256").update(historyGroupKey(g)).digest("hex").slice(0, 36)}`;
    return {
        id,
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        priority: 50,
        schedule: null,
        next_run_at: null,
        past_due: null,
        name: g.name,
        params: { source: g.source, resource: g.resource },
        opid: null,
        service_group: null,
        instance_number: null,
        service_name: null,
        server_name: g.repServer,
        status: "completed",
        status_changed_at: null,
        progress: null,
        success: true,
        results: null,
    };
}

async function loadHistoryGroups(db, historyTable) {
    const rows = await db(historyTable)
        .select(
            db.raw("name"),
            db.raw(`coalesce(params->>'source', '') as source`),
            db.raw(`coalesce(params->>'resource', '') as resource`),
            db.raw("count(*)::int as count"),
            db.raw(
                "(array_agg(server_name ORDER BY completed_at DESC NULLS LAST))[1] as rep_server"
            )
        )
        .groupByRaw(`name, coalesce(params->>'source', ''), coalesce(params->>'resource', '')`)
        .orderByRaw("count desc")
        .limit(500);
    return rows.map((r) => ({
        name: String(r.name ?? ""),
        source: String(r.source ?? ""),
        resource: String(r.resource ?? ""),
        count: Number(r.count ?? 0),
        repServer: r.rep_server != null && String(r.rep_server).trim() ? String(r.rep_server).trim() : null,
    }));
}

async function fetchLatestHistoryRowForGroup(db, historyTable, g) {
    const row = await db(historyTable)
        .where({ name: g.name })
        .whereRaw("coalesce(params->>'source', '') = ?", [g.source])
        .whereRaw("coalesce(params->>'resource', '') = ?", [g.resource])
        .orderBy([{ column: "completed_at", order: "desc" }, { column: "created_at", order: "desc" }])
        .first();
    return row ?? null;
}

function linesForHistoryResultPreview(row) {
    const cols = Math.max(40, (process.stdout.columns || 80) - 2);
    if (!row) {
        return ["(no matching history row)"];
    }
    const payload = {
        id: row.id,
        name: row.name,
        success: row.success,
        completed_at: row.completed_at,
        results: row.results,
        server_name: row.server_name,
        service_name: row.service_name,
    };
    const json = JSON.stringify(payload, null, 2);
    return json
        .split("\n")
        .slice(0, 80)
        .map((ln) => (ln.length > cols ? `${ln.slice(0, cols - 1)}…` : ln));
}

const HISTORY_GAP = 2;

function computeHistoryGroupColumnWidths(rows) {
    const minNm = 6;
    const minSrc = 6;
    const minRes = 6;
    const minCnt = 5;
    const nm = Math.max(minNm, "name".length, ...rows.map((r) => String(r.name ?? "").length));
    const src = Math.max(minSrc, "source".length, ...rows.map((r) => String(r.source ?? "").length));
    const res = Math.max(minRes, "resource".length, ...rows.map((r) => String(r.resource ?? "").length));
    const cnt = Math.max(minCnt, "count".length, ...rows.map((r) => String(r.count ?? 0).length));
    const markerArrow = 4;
    const inner = nm + HISTORY_GAP + src + HISTORY_GAP + res + HISTORY_GAP + cnt;
    const termW = Math.max(48, (process.stdout.columns || 80) - 6 - markerArrow);
    if (inner <= termW) return { nm, src, res, cnt };
    const overflow = inner - termW;
    const nm2 = Math.max(minNm, nm - Math.floor(overflow * 0.4));
    const src2 = Math.max(minSrc, src - Math.ceil(overflow * 0.35));
    const res2 = Math.max(minRes, res - Math.ceil(overflow * 0.25));
    return { nm: nm2, src: src2, res: res2, cnt };
}

function formatHistoryGroupLine(r, w) {
    const a = padOrTruncateCell(String(r.name ?? ""), w.nm);
    const b = padOrTruncateCell(String(r.source ?? ""), w.src);
    const c = padOrTruncateCell(String(r.resource ?? ""), w.res);
    const d = padOrTruncateCell(String(r.count ?? 0), w.cnt);
    return `${a}${" ".repeat(HISTORY_GAP)}${b}${" ".repeat(HISTORY_GAP)}${c}${" ".repeat(HISTORY_GAP)}${d}`;
}

function formatHistoryGroupHeader(w) {
    return `${padOrTruncateCell("name", w.nm)}${" ".repeat(HISTORY_GAP)}${padOrTruncateCell("source", w.src)}${" ".repeat(HISTORY_GAP)}${padOrTruncateCell("resource", w.res)}${" ".repeat(HISTORY_GAP)}${padOrTruncateCell("count", w.cnt)}`;
}

function buildInfoTaskResultText(row) {
    const parsed = parseTaskResults(row.results);
    const cols = Math.max(40, (process.stdout.columns || 80) - 2);
    const title = `info task ${row.name} ${String(row.id).slice(0, 8)} — ${row.success === false ? "failed" : "ok"}`;
    if (row.success === false) {
        const err = parsed && typeof parsed === "object" && "error" in parsed ? String(parsed.error) : JSON.stringify(parsed);
        return { title, lines: [err.slice(0, cols)] };
    }
    const json = JSON.stringify(parsed ?? null, null, 2);
    const lines = json
        .split("\n")
        .slice(0, 48)
        .map((ln) => (ln.length > cols ? `${ln.slice(0, cols - 1)}…` : ln));
    return { title, lines };
}

function showRegistryPickerScreen(context, db, registryTable, tasksTable, pollMs, queueName) {
    return showScreen({
        title: `Services registry — ${registryTable}`,
        onRender: (ctx) => {
            ctx.setAction("back", () => ctx.close(null));
            ctx.setAction("refresh", () => ctx.update());
            ctx.setKeyBinding([
                { key: "escape", caption: "back", action: "back", order: 1 },
                { key: "q", caption: "back", action: "back", order: 1 },
                { key: "r", caption: "refresh", action: "refresh", order: 2 },
            ]);

            const RegistryPicker = () => {
                const [rows, setRows] = useState([]);
                const [lastUpdated, setLastUpdated] = useState("-");
                const [errorText, setErrorText] = useState("");
                const [infoPanel, setInfoPanel] = useState(null);
                const infoPanelRef = useRef(null);
                infoPanelRef.current = infoPanel;
                const selectedIndexRef = useRef(0);
                const itemsRef = useRef([]);

                const colWidths = useMemo(() => computeRegistryColumnWidths(rows), [rows]);

                const items = useMemo(
                    () =>
                        rows.map((r) => ({
                            name: formatRegistryTableLine(r, colWidths),
                            value: r,
                        })),
                    [rows, colWidths]
                );
                itemsRef.current = items;

                useEffect(() => {
                    let active = true;
                    const load = async () => {
                        if (infoPanelRef.current != null) {
                            return;
                        }
                        try {
                            const loaded = await db(registryTable)
                                .select("*")
                                .orderBy([
                                    { column: "service_group", order: "asc" },
                                    { column: "instance_number", order: "asc" },
                                    { column: "service_name", order: "asc" },
                                ]);
                            if (!active) return;
                            const counts = await Promise.all(loaded.map((r) => countRunningTasksForRegistry(db, tasksTable, r)));
                            const merged = loaded.map((r, i) => ({
                                ...r,
                                runningCount: counts[i] ?? 0,
                            }));
                            setRows(merged);
                            setLastUpdated(new Date().toISOString());
                            setErrorText("");
                        } catch (e) {
                            if (!active) return;
                            setErrorText(e?.message ?? String(e));
                        }
                    };
                    void load();
                    const t = setInterval(load, Math.max(200, Number(pollMs) || 1500));
                    return () => {
                        active = false;
                        clearInterval(t);
                    };
                }, [registryTable, tasksTable, pollMs]);

                useEffect(() => {
                    if (items.length === 0) return;
                    if (selectedIndexRef.current >= items.length) {
                        selectedIndexRef.current = items.length - 1;
                    }
                }, [items.length]);

                useEffect(() => {
                    ctx.setAction("select", () => {
                        const list = itemsRef.current;
                        const idx = selectedIndexRef.current;
                        const picked = list[idx];
                        if (picked) ctx.close(picked.value);
                    });
                    ctx.setAction("serviceInfo", () => {
                        const picked = itemsRef.current[selectedIndexRef.current]?.value;
                        if (!picked) return;
                        setInfoPanel({ phase: "loading" });
                        ctx.update();
                        void (async () => {
                            try {
                                const opid = `info_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
                                const inst = Math.max(
                                    1,
                                    Number.isFinite(Number(picked.instance_number))
                                        ? Math.floor(Number(picked.instance_number))
                                        : 1
                                );
                                const taskId = await enqueueTask(context, {
                                    queueName,
                                    name: "info",
                                    opid,
                                    priority: 0,
                                    params: {},
                                    serviceGroup: picked.service_group,
                                    serviceName: picked.service_name,
                                    instanceNumber: inst,
                                    serverName: picked.server_name,
                                });
                                const done = await waitForTaskResult(context, taskId, {
                                    queueName,
                                    timeoutMs: 90_000,
                                    pollMs: 350,
                                });
                                if (!done) {
                                    setInfoPanel({
                                        phase: "error",
                                        message: "Timed out waiting for info task (runner down or busy?)",
                                    });
                                } else {
                                    const out = buildInfoTaskResultText(done);
                                    setInfoPanel({ phase: "ok", title: out.title, lines: out.lines });
                                }
                            } catch (e) {
                                setInfoPanel({ phase: "error", message: e?.message ?? String(e) });
                            }
                            ctx.update();
                        })();
                    });
                    ctx.setKeyBinding([
                        { key: "return", caption: "open", action: "select", order: 3 },
                        { key: "i", caption: "info task", action: "serviceInfo", order: 4 },
                    ]);
                }, [ctx, queueName]);

                const termRows = process.stdout.rows || 24;
                const infoReserve =
                    infoPanel == null
                        ? 0
                        : infoPanel.phase === "loading"
                          ? 3
                          : infoPanel.phase === "error"
                            ? 4
                            : 3 + Math.min(infoPanel.lines.length, 28);
                const maxList = Math.max(4, Math.min(22, termRows - 10 - infoReserve));

                const headerBody = formatRegistryHeader(colWidths);
                const headerLine = `${REGISTRY_LIST_ROW_PREFIX}${headerBody}`;
                const ruleBodyLen = Math.min(
                    (process.stdout.columns || 80) - 4 - REGISTRY_LIST_ROW_PREFIX.length,
                    headerBody.length
                );
                const rule = `${REGISTRY_LIST_ROW_PREFIX}${"-".repeat(Math.max(ruleBodyLen, 20))}`;

                return h(Box, { flexDirection: "column" },
                    h(Text, {}, `updated: ${lastUpdated} | entries: ${rows.length}  (↑↓ select  Enter=open  i=info  r=refresh  q=back)`),
                    errorText ? h(Text, { color: "red" }, `error: ${errorText}`) : h(Text, {}, ""),
                    rows.length === 0
                        ? h(Text, { color: "gray" }, "No rows in registry (or still loading).")
                        : h(Box, { flexDirection: "column" },
                              h(Text, { color: "cyan" }, headerLine),
                              h(Text, { color: "gray" }, rule),
                              h(ListComponent, {
                                  items,
                                  ctx,
                                  selectedIndexRef,
                                  maxHeight: maxList,
                              }),
                              infoPanel != null && infoPanel.phase === "loading"
                                  ? h(Text, { color: "yellow" }, "info task: waiting for targeted runner…")
                                  : null,
                              infoPanel != null && infoPanel.phase === "error"
                                  ? h(Text, { color: "red" }, `info task: ${infoPanel.message}`)
                                  : null,
                              infoPanel != null && infoPanel.phase === "ok"
                                  ? h(
                                        Box,
                                        { flexDirection: "column" },
                                        h(Text, { color: "cyan" }, infoPanel.title),
                                        ...infoPanel.lines.map((ln, i) => h(Text, { key: `inl${i}` }, ln))
                                    )
                                  : null
                          )
                );
            };

            return h(RegistryPicker, {});
        },
    });
}

function showServiceRunningScreen(db, tasksTable, reg, pollMs) {
    return showScreen({
        title: `Running — ${reg.service_name}`,
        onRender: (ctx) => {
            ctx.setAction("back", () => ctx.close(null));
            ctx.setAction("refresh", () => ctx.update());
            ctx.setKeyBinding([
                { key: "escape", caption: "back", action: "back", order: 1 },
                { key: "q", caption: "back", action: "back", order: 1 },
                { key: "r", caption: "refresh", action: "refresh", order: 2 },
            ]);

            const Detail = () => {
                const [rows, setRows] = useState([]);
                const [lastUpdated, setLastUpdated] = useState("-");
                const [errorText, setErrorText] = useState("");

                useEffect(() => {
                    let active = true;
                    const load = async () => {
                        try {
                            const loaded = await db(tasksTable)
                                .where({ status: "running", service_group: reg.service_group })
                                .where((b) => {
                                    b.where("service_name", reg.service_name).orWhereNull("service_name");
                                })
                                .orderBy([{ column: "started_at", order: "asc" }]);
                            if (!active) return;
                            setRows(loaded);
                            setLastUpdated(new Date().toISOString());
                            setErrorText("");
                        } catch (e) {
                            if (!active) return;
                            setErrorText(e?.message ?? String(e));
                        }
                    };
                    void load();
                    const t = setInterval(load, Math.max(200, Number(pollMs) || 1500));
                    return () => {
                        active = false;
                        clearInterval(t);
                    };
                }, [tasksTable, pollMs, reg.service_group, reg.service_name]);

                const header =
                    "name".padEnd(18) +
                    " svc on task ".padEnd(22) +
                    " started".padEnd(20) +
                    " progress";
                const divider = "-".repeat(Math.min(100, header.length + 40));

                return h(Box, { flexDirection: "column" },
                    h(Text, { color: "cyan" }, `registry: ${reg.server_name} | group=${reg.service_group} | last_seen=${formatTs(reg.last_seen_at)}`),
                    h(Text, {}, `running rows (this identity or unlabeled in group): ${rows.length} | updated: ${lastUpdated}`),
                    errorText ? h(Text, { color: "red" }, `error: ${errorText}`) : h(Text, {}, ""),
                    h(Text, { color: "cyan" }, header),
                    h(Text, { color: "gray" }, divider),
                    ...rows.map((row) => {
                        const sn = row.service_name ?? "";
                        const match = sn === reg.service_name || sn === "";
                        const line =
                            oneLine(row.name, 18).padEnd(18) +
                            oneLine(sn || "(null)", 22).padEnd(22) +
                            formatTs(row.started_at).padEnd(20) +
                            oneLine(row.progress, 48);
                        return h(Text, { key: String(row.id), color: match ? "green" : "yellow" }, line);
                    })
                );
            };

            return h(Detail, {});
        },
    });
}

const LogTailPanel = memo(function LogTailPanel(props) {
    const linesAccRef = useRef([]);
    const maxTsRef = useRef(null);
    const initRef = useRef(false);
    const [lines, setLines] = useState([]);
    const [scrollTop, setScrollTop] = useState(0);
    const [err, setErr] = useState("");
    const [hint, setHint] = useState("-");
    const viewportRows = Math.max(4, (process.stdout.rows || 24) - 10);
    const serverHint = props.row.server_name?.trim() || os.hostname();

    useEffect(() => {
        initRef.current = false;
        maxTsRef.current = null;
        linesAccRef.current = [];
        setLines([]);
        setScrollTop(0);
        setErr("");
        setHint("-");
    }, [props.row.id]);

    useEffect(() => {
        let cancelled = false;
        const tick = async () => {
            try {
                if (!initRef.current) {
                    const { records, latestTs } = await fetchLogRecordsForMonitor(props.context, props.queueName, props.row, {
                        tail: props.logInitialTail,
                        afterTs: null,
                    });
                    if (cancelled) return;
                    linesAccRef.current = records.map((r) => formatLogRecordLine(r));
                    setLines([...linesAccRef.current]);
                    maxTsRef.current = latestTs ?? null;
                    initRef.current = true;
                    setHint(`host ${serverHint} | initial ${records.length} lines`);
                    setScrollTop(Math.max(0, linesAccRef.current.length - viewportRows));
                    setErr("");
                    return;
                }
                const tailAfter = maxTsRef.current;
                const { records, latestTs } = await fetchLogRecordsForMonitor(props.context, props.queueName, props.row, {
                    tail: 800,
                    afterTs: tailAfter,
                });
                if (cancelled) return;
                if (records.length > 0) {
                    const beforeLen = linesAccRef.current.length;
                    const newLines = records.map((r) => formatLogRecordLine(r));
                    linesAccRef.current = [...linesAccRef.current, ...newLines].slice(-12_000);
                    const afterLen = linesAccRef.current.length;
                    setLines([...linesAccRef.current]);
                    if (typeof latestTs === "string" && (!maxTsRef.current || latestTs > maxTsRef.current)) {
                        maxTsRef.current = latestTs;
                    }
                    setHint(`host ${serverHint} | +${newLines.length} new @ ${new Date().toISOString().slice(11, 19)}Z`);
                    setErr("");
                    const oldMaxScroll = Math.max(0, beforeLen - viewportRows);
                    const newMaxScroll = Math.max(0, afterLen - viewportRows);
                    setScrollTop((prev) => (prev >= oldMaxScroll ? newMaxScroll : prev));
                }
                // No new records: skip setState — avoids unnecessary redraws (tail -f style).
            } catch (e) {
                if (!cancelled) setErr(e?.message ?? String(e));
            }
        };
        void tick();
        const poll = Math.max(500, Number(props.logPollMs) || 2000);
        const t = setInterval(() => void tick(), poll);
        return () => {
            cancelled = true;
            clearInterval(t);
        };
    }, [props.row.id, props.queueName, props.logInitialTail, props.logPollMs, props.context, serverHint]);

    useEffect(() => {
        const maxScroll = Math.max(0, lines.length - viewportRows);
        setScrollTop((s) => Math.min(s, maxScroll));
    }, [lines.length, viewportRows]);

    useEffect(() => {
        props.ctx.setAction("back", () => props.onBack());
        props.ctx.setAction("logUp", () => setScrollTop((s) => Math.max(0, s - 1)));
        props.ctx.setAction("logDown", () =>
            setScrollTop((s) => Math.min(Math.max(0, lines.length - viewportRows), s + 1))
        );
        props.ctx.setKeyBinding([
            { key: "escape", caption: "tasks list", action: "back", order: 1 },
            { key: "q", caption: "tasks list", action: "back", order: 1 },
            { key: "upArrow", caption: "scroll", action: "logUp", order: 0 },
            { key: "downArrow", caption: "scroll", action: "logDown", order: 0 },
        ]);
    }, [props.ctx, props.onBack, lines.length, viewportRows]);

    const visible = lines.slice(scrollTop, scrollTop + viewportRows);
    const p = taskParamsObject(props.row);
    const title = `${String(p.source ?? "?")}/${String(p.resource ?? "?")}`;

    return h(Box, { flexDirection: "column" },
        h(Text, { color: "cyan" }, `IPC logs — dummyHarvest ${title} | target ${serverHint} (getLogs)`),
        h(Text, { color: "gray" }, hint),
        err ? h(Text, { color: "red" }, `error: ${err}`) : h(Text, {}, ""),
        ...visible.map((line, i) => h(Text, { key: `${scrollTop + i}` }, line))
    );
});

function showTasksQueueScreen(context, db, queueName, tasksTable, pollMs, logTailPollMs, logTailInitial, serviceGroupFilter) {
    const filterNote = serviceGroupFilter ? `service_group=${serviceGroupFilter}` : "all rows";
    return showScreen({
        title: `Tasks — ${tasksTable} (${filterNote})`,
        onRender: (ctx) => {
            ctx.setAction("back", () => ctx.close(null));
            ctx.setAction("refresh", () => ctx.update());

            const Watch = () => {
                const [rows, setRows] = useState([]);
                const [lastUpdated, setLastUpdated] = useState("-");
                const [errorText, setErrorText] = useState("");
                const [userHint, setUserHint] = useState("");
                const [logRow, setLogRow] = useState(null);
                const [pollPaused, setPollPaused] = useState(false);
                const [selectedId, setSelectedId] = useState(null);
                const selectedIndexRef = useRef(0);
                const rowsRef = useRef([]);

                const selectedIndex = useMemo(() => {
                    if (rows.length === 0) return 0;
                    if (selectedId) {
                        const i = rows.findIndex((r) => r.id === selectedId);
                        if (i >= 0) return i;
                    }
                    return 0;
                }, [rows, selectedId]);

                selectedIndexRef.current = selectedIndex;

                useEffect(() => {
                    if (rows.length === 0) return;
                    if (selectedId == null) {
                        const id = rows[0]?.id;
                        if (id) setSelectedId(id);
                    }
                }, [rows, selectedId]);

                const clearLogRow = useCallback(() => setLogRow(null), []);

                /** `svc` / `started` widths only increase when data demands it; never shrink when later rows are shorter or empty. */
                const tasksSvcWidthPeakRef = useRef(0);
                const tasksStartedWidthPeakRef = useRef(0);

                useEffect(() => {
                    let active = true;
                    const load = async () => {
                        if (pollPaused) {
                            return;
                        }
                        /** Task list poll would re-render the whole watch subtree and flicker the log viewer. */
                        if (logRow) {
                            return;
                        }
                        try {
                            let q = db(tasksTable)
                                .select(
                                    "id",
                                    "name",
                                    "status",
                                    "service_name",
                                    "server_name",
                                    "service_group",
                                    "params",
                                    "priority",
                                    "started_at",
                                    "next_run_at",
                                    "past_due",
                                    "progress",
                                    "created_at"
                                )
                                .orderBy([{ column: "created_at", order: "desc" }])
                                .limit(200);
                            if (serviceGroupFilter) {
                                q = q.where({ service_group: serviceGroupFilter });
                            }
                            const loaded = await q;
                            if (!active) return;
                            setRows(loaded);
                            rowsRef.current = loaded;
                            setLastUpdated(new Date().toISOString());
                            setErrorText("");
                        } catch (e) {
                            if (!active) return;
                            setErrorText(e?.message ?? String(e));
                        }
                    };
                    void load();
                    const t = setInterval(load, Math.max(200, Number(pollMs) || 1500));
                    return () => {
                        active = false;
                        clearInterval(t);
                    };
                }, [tasksTable, pollMs, serviceGroupFilter, pollPaused, logRow]);

                useEffect(() => {
                    if (logRow) {
                        return;
                    }
                    ctx.setAction("back", () => ctx.close(null));
                    ctx.setAction("refresh", () => ctx.update());
                    ctx.setAction("togglePause", () => {
                        setPollPaused((p) => !p);
                        ctx.update();
                    });
                    ctx.setAction("select", () => {
                        const row = rowsRef.current[selectedIndexRef.current];
                        setUserHint("");
                        if (!row) return;
                        if (row.name !== "dummyHarvest") {
                            setUserHint('Open logs: select a dummyHarvest row (Enter).');
                            ctx.update();
                            return;
                        }
                        const ps = taskParamsObject(row);
                        if (!String(ps.source ?? "").trim() || !String(ps.resource ?? "").trim()) {
                            setUserHint("dummyHarvest row needs params.source and params.resource.");
                            ctx.update();
                            return;
                        }
                        setLogRow(row);
                    });
                    ctx.setKeyBinding([
                        { key: "escape", caption: "back", action: "back", order: 1 },
                        { key: "q", caption: "back", action: "back", order: 1 },
                        { key: "r", caption: "refresh", action: "refresh", order: 2 },
                        { key: "p", caption: "pause poll", action: "togglePause", order: 3 },
                        { key: "return", caption: "view logs", action: "select", order: 4 },
                    ]);
                }, [logRow, ctx]);

                const now = new Date();
                const colWidths = computeTasksQueueColumnWidths(rows, now, {
                    svc: tasksSvcWidthPeakRef.current,
                    started: tasksStartedWidthPeakRef.current,
                });
                tasksSvcWidthPeakRef.current = colWidths.svc;
                tasksStartedWidthPeakRef.current = colWidths.started;

                const headerBody = formatTasksQueueHeader(colWidths);
                const divider = "-".repeat(Math.min(120, Math.max(40, headerBody.length)));

                const listHeight = Math.max(6, (process.stdout.rows || 24) - 9);

                const items = rows.map((row) => ({
                    name: formatTasksQueueTableLine(row, colWidths, now),
                    value: row,
                }));

                if (logRow) {
                    return h(LogTailPanel, {
                        key: logRow.id,
                        ctx,
                        context,
                        queueName,
                        row: logRow,
                        logPollMs: logTailPollMs,
                        logInitialTail: logTailInitial,
                        onBack: clearLogRow,
                    });
                }

                return h(Box, { flexDirection: "column" },
                    h(
                        Text,
                        {},
                        `rows: ${rows.length} | updated: ${lastUpdated} | ${pollPaused ? "PAUSED" : "live"} (↑↓ Enter=logs) p=pause`
                    ),
                    userHint ? h(Text, { color: "yellow" }, userHint) : h(Text, {}, ""),
                    errorText ? h(Text, { color: "red" }, `error: ${errorText}`) : h(Text, {}, ""),
                    h(Text, { color: "cyan" }, headerBody),
                    h(Text, { color: "gray" }, divider),
                    h(ListComponent, {
                        items,
                        ctx,
                        selectedIndexRef,
                        maxHeight: listHeight,
                        getTitle: (it) => it.name,
                        onSelectionChange: (_idx, item) => {
                            const row = item?.value;
                            if (row?.id) setSelectedId(row.id);
                        },
                    })
                );
            };

            return h(Watch, {});
        },
    });
}

const HistoryJsonPanel = memo(function HistoryJsonPanel(props) {
    useEffect(() => {
        props.ctx.setAction("back", () => props.onBack());
        props.ctx.setKeyBinding([
            { key: "escape", caption: "back", action: "back", order: 1 },
            { key: "q", caption: "back", action: "back", order: 1 },
        ]);
    }, [props.ctx, props.onBack]);

    return h(Box, { flexDirection: "column" },
        h(Text, { color: "cyan" }, props.title),
        ...props.lines.map((ln, i) => h(Text, { key: `hj${i}` }, ln))
    );
});

function showTasksHistoryScreen(context, db, queueName, historyTable, pollMs, logTailPollMs, logTailInitial) {
    return showScreen({
        title: `Tasks history — ${historyTable}`,
        onRender: (ctx) => {
            ctx.setAction("back", () => ctx.close(null));
            ctx.setAction("refresh", () => ctx.update());

            const Watch = () => {
                const [groups, setGroups] = useState([]);
                const [lastUpdated, setLastUpdated] = useState("-");
                const [errorText, setErrorText] = useState("");
                const [view, setView] = useState(null);
                const [selectedKey, setSelectedKey] = useState(null);
                const selectedIndexRef = useRef(0);
                const groupsRef = useRef([]);

                const selectedIndex = useMemo(() => {
                    if (groups.length === 0) return 0;
                    if (selectedKey) {
                        const i = groups.findIndex((g) => historyGroupKey(g) === selectedKey);
                        if (i >= 0) return i;
                    }
                    return 0;
                }, [groups, selectedKey]);
                selectedIndexRef.current = selectedIndex;

                useEffect(() => {
                    if (groups.length === 0) return;
                    if (selectedKey == null) {
                        setSelectedKey(historyGroupKey(groups[0]));
                    }
                }, [groups, selectedKey]);

                const clearView = useCallback(() => setView(null), []);

                useEffect(() => {
                    let active = true;
                    const load = async () => {
                        if (view) {
                            return;
                        }
                        try {
                            const loaded = await loadHistoryGroups(db, historyTable);
                            if (!active) return;
                            setGroups(loaded);
                            groupsRef.current = loaded;
                            setLastUpdated(new Date().toISOString());
                            setErrorText("");
                        } catch (e) {
                            if (!active) return;
                            setErrorText(e?.message ?? String(e));
                        }
                    };
                    void load();
                    const t = setInterval(load, Math.max(200, Number(pollMs) || 1500));
                    return () => {
                        active = false;
                        clearInterval(t);
                    };
                }, [historyTable, pollMs, view]);

                useEffect(() => {
                    if (view) {
                        return;
                    }
                    ctx.setAction("back", () => ctx.close(null));
                    ctx.setAction("refresh", () => ctx.update());
                    ctx.setAction("select", () => {
                        const g = groupsRef.current[selectedIndexRef.current];
                        if (!g) return;
                        const src = String(g.source ?? "").trim();
                        const res = String(g.resource ?? "").trim();
                        if (src && res) {
                            setView({ kind: "ipc", row: syntheticTaskRowForHistoryGroup(g) });
                            ctx.update();
                        } else {
                            void (async () => {
                                try {
                                    const latest = await fetchLatestHistoryRowForGroup(db, historyTable, g);
                                    setView({
                                        kind: "json",
                                        title: `Last run — ${g.name} (${g.count}× in history, no IPC logs without source/resource)`,
                                        lines: linesForHistoryResultPreview(latest),
                                    });
                                } catch (e) {
                                    setView({
                                        kind: "json",
                                        title: "Error",
                                        lines: [e?.message ?? String(e)],
                                    });
                                }
                                ctx.update();
                            })();
                        }
                    });
                    ctx.setKeyBinding([
                        { key: "escape", caption: "back", action: "back", order: 1 },
                        { key: "q", caption: "back", action: "back", order: 1 },
                        { key: "r", caption: "refresh", action: "refresh", order: 2 },
                        { key: "return", caption: "view logs", action: "select", order: 3 },
                    ]);
                }, [view, ctx, historyTable]);

                const colWidths = useMemo(() => computeHistoryGroupColumnWidths(groups), [groups]);
                const headerBody = formatHistoryGroupHeader(colWidths);
                const divider = "-".repeat(Math.min(120, Math.max(40, headerBody.length)));
                const listHeight = Math.max(6, (process.stdout.rows || 24) - 9);

                const items = groups.map((g) => ({
                    name: formatHistoryGroupLine(g, colWidths),
                    value: g,
                }));

                if (view?.kind === "ipc") {
                    return h(LogTailPanel, {
                        key: view.row.id,
                        ctx,
                        context,
                        queueName,
                        row: view.row,
                        logPollMs: logTailPollMs,
                        logInitialTail: logTailInitial,
                        onBack: clearView,
                    });
                }

                if (view?.kind === "json") {
                    return h(HistoryJsonPanel, {
                        key: "json-panel",
                        ctx,
                        title: view.title,
                        lines: view.lines,
                        onBack: clearView,
                    });
                }

                return h(Box, { flexDirection: "column" },
                    h(
                        Text,
                        {},
                        `groups: ${groups.length} | updated: ${lastUpdated} (↑↓ Enter=logs / results)`
                    ),
                    errorText ? h(Text, { color: "red" }, `error: ${errorText}`) : h(Text, {}, ""),
                    h(Text, { color: "gray" }, "Grouped by name + params.source + params.resource. Open IPC logs when source/resource are set."),
                    groups.length === 0 && !errorText
                        ? h(Text, { color: "gray" }, "No completed tasks in history yet.")
                        : null,
                    groups.length > 0
                        ? h(Box, { flexDirection: "column" },
                              h(Text, { color: "cyan" }, headerBody),
                              h(Text, { color: "gray" }, divider),
                              h(ListComponent, {
                                  items,
                                  ctx,
                                  selectedIndexRef,
                                  maxHeight: listHeight,
                                  getTitle: (it) => it.name,
                                  onSelectionChange: (_idx, item) => {
                                      const g = item?.value;
                                      if (g) setSelectedKey(historyGroupKey(g));
                                  },
                              })
                          )
                        : null
                );
            };

            return h(Watch, {});
        },
    });
}

const flow = async (context) => {
    const {
        table,
        pollMs,
        target,
        maintenanceIntervalMs,
        maintenancePingTimeoutMs,
        maintenanceRegistry,
        logTailInitial,
        logTailPollMs,
    } = context.params.getAll(defs);
    const db = await Db.init(context);
    context.db = db;
    const { tasksTable, registryTable, historyTable } = queueToTableNames(table);
    const targetFilter = typeof target === "string" && target.trim() ? target.trim() : undefined;

    // Fail fast if registry table missing (optional UX)
    const hasRegistry = await db.tableExists(registryTable).catch(() => false);
    if (!hasRegistry) {
        context.logger?.warn?.(`[tasks-monitor] No table ${registryTable}; only "Tasks queue" mode is useful.`);
    }

    const hasHistory = await db.tableExists(historyTable).catch(() => false);
    if (!hasHistory) {
        context.logger?.warn?.(`[tasks-monitor] No table ${historyTable}; "Tasks history" menu entry is hidden.`);
    }

    let maintenanceTimer = null;
    if (hasRegistry && maintenanceRegistry !== false) {
        const intervalMs = Math.max(1000, Number(maintenanceIntervalMs) || 10_000);
        const pingTimeoutMs = Math.max(200, Number(maintenancePingTimeoutMs) || 1000);
        let maintenanceBusy = false;
        const runRegistryMaintenance = async () => {
            if (maintenanceBusy) {
                return;
            }
            maintenanceBusy = true;
            try {
                const result = await maintainRegistryLiveness(context, {
                    queueName: table,
                    pingTimeoutMs,
                });
                const log = context.logger;
                if (result.removed > 0) {
                    log?.info?.(
                        `[tasks-monitor] registry maintenance: removed ${result.removed} dead service(s), checked ${result.checked}`
                    );
                }
                if (result.errors.length > 0) {
                    log?.warn?.(`[tasks-monitor] registry maintenance errors: ${result.errors.slice(0, 5).join(" | ")}`);
                }
            } catch (e) {
                context.logger?.warn?.(`[tasks-monitor] registry maintenance failed: ${e?.message ?? String(e)}`);
            } finally {
                maintenanceBusy = false;
            }
        };
        void runRegistryMaintenance();
        maintenanceTimer = setInterval(() => {
            void runRegistryMaintenance();
        }, intervalMs);
    }

    try {
        for (;;) {
            const items = [
                { name: "Services (registry)", value: "services" },
                { name: "Tasks queue (recent rows)", value: "tasks" },
                ...(hasHistory ? [{ name: "Tasks history", value: "history" }] : []),
                { name: "Quit", value: "quit" },
            ];
            if (!hasRegistry) {
                items.splice(0, 1);
            }

            const choice = await showListScreen({
                title: `Monitor — ${tasksTable}`,
                items,
                onSelect: (v) => v,
            });

            if (choice === "quit" || choice == null) break;

            if (choice === "services" && hasRegistry) {
                for (;;) {
                    const reg = await showRegistryPickerScreen(context, db, registryTable, tasksTable, pollMs, table);
                    if (!reg) break;
                    await showServiceRunningScreen(db, tasksTable, reg, pollMs);
                }
            } else if (choice === "tasks") {
                await showTasksQueueScreen(
                    context,
                    db,
                    table,
                    tasksTable,
                    pollMs,
                    Math.max(500, Number(logTailPollMs) || 2000),
                    Math.max(10, Math.min(10_000, Number(logTailInitial) || 120)),
                    targetFilter
                );
            } else if (choice === "history" && hasHistory) {
                await showTasksHistoryScreen(
                    context,
                    db,
                    table,
                    historyTable,
                    pollMs,
                    Math.max(500, Number(logTailPollMs) || 2000),
                    Math.max(10, Math.min(10_000, Number(logTailInitial) || 120))
                );
            }
        }
    } finally {
        if (maintenanceTimer != null) {
            clearInterval(maintenanceTimer);
            maintenanceTimer = null;
        }
    }
};

void init(flow);
