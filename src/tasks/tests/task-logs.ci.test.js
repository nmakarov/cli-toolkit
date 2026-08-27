import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { filterIpcLogRecords, readTaskIpcLogsSnapshot } from "../taskLogs.js";
import { FileDatabase } from "../../filedatabase/index.js";

describe("filterIpcLogRecords", () => {
    const records = [
        { ts: "2026-08-24T17:59:00.000Z", payload: "prev" },
        { ts: "2026-08-24T18:00:00.000Z", payload: "start" },
        { ts: "2026-08-24T18:05:00.000Z", payload: "mid" },
        { ts: "2026-08-24T18:10:00.000Z", payload: "end" },
        { ts: "2026-08-24T18:20:00.000Z", payload: "next" },
    ];

    it("applies afterTs exclusively and fromTs/toTs inclusively", () => {
        expect(
            filterIpcLogRecords(records, { afterTs: "2026-08-24T18:00:00.000Z" }).map((r) => r.payload),
        ).toEqual(["mid", "end", "next"]);
        expect(
            filterIpcLogRecords(records, {
                fromTs: "2026-08-24T18:00:00.000Z",
                toTs: "2026-08-24T18:10:00.000Z",
            }).map((r) => r.payload),
        ).toEqual(["start", "mid", "end"]);
    });

    it("keeps only records stamped with taskId", () => {
        const mixed = [
            { ts: "2026-08-24T18:00:00.000Z", taskId: "a", payload: "mine" },
            { ts: "2026-08-24T18:01:00.000Z", taskId: "b", payload: "other" },
            { ts: "2026-08-24T18:02:00.000Z", payload: "unstamped" },
        ];
        expect(filterIpcLogRecords(mixed, { taskId: "a" }).map((r) => r.payload)).toEqual(["mine"]);
    });
});

describe("readTaskIpcLogsSnapshot", () => {
    const tmpDirs = [];
    afterEach(() => {
        for (const dir of tmpDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function makeCtx(tmpDir) {
        return {
            logger: { warn: () => {}, info: () => {} },
            params: {
                get: (key) =>
                    ({
                        tasksLogsBasePath: tmpDir,
                        tasksLogsNamespace: "tasks-logs",
                    })[key],
            },
        };
    }

    async function writeVersion(tmpDir, records) {
        const fd = new FileDatabase({
            basePath: tmpDir,
            namespace: "tasks-logs",
            tableName: "bright/intake",
            versioned: true,
            useMetadata: true,
            maxVersions: 30,
            pageSize: 2000,
            logger: { warn: () => {} },
        });
        await fd.write(records, { forceNewVersion: true });
        return fd.getCurrentVersion();
    }

    it("rebuilds from data files when the latest metadata.json is truncated", async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), "ipc-snapshot-"));
        tmpDirs.push(tmpDir);
        await writeVersion(tmpDir, [
            { ts: "2026-08-27T21:00:00.000Z", taskId: "older", payload: "prev" },
        ]);
        const latest = await writeVersion(tmpDir, [
            { ts: "2026-08-27T21:35:09.000Z", taskId: "live", payload: "now" },
        ]);
        const latestDir = join(tmpDir, "tasks-logs", "bright", "intake", latest);
        writeFileSync(join(latestDir, "metadata.json"), '{"version":"', "utf8");

        const out = await readTaskIpcLogsSnapshot(makeCtx(tmpDir), {
            source: "bright",
            resource: "intake",
            fromTs: "2026-08-27T21:00:00.000Z",
        });
        expect(out.records.map((r) => r.payload)).toEqual(["prev", "now"]);
    });

    it("skips a version that is still unreadable and returns the rest", async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), "ipc-snapshot-skip-"));
        tmpDirs.push(tmpDir);
        await writeVersion(tmpDir, [
            { ts: "2026-08-27T21:00:00.000Z", taskId: "older", payload: "kept" },
        ]);
        const latest = await writeVersion(tmpDir, [
            { ts: "2026-08-27T21:35:09.000Z", taskId: "live", payload: "gone" },
        ]);
        const latestDir = join(tmpDir, "tasks-logs", "bright", "intake", latest);
        writeFileSync(join(latestDir, "metadata.json"), '{"version":"', "utf8");
        const chunk = readdirSync(latestDir).find((name) => name.endsWith(".json") && name !== "metadata.json");
        writeFileSync(join(latestDir, chunk), "[{", "utf8");

        const out = await readTaskIpcLogsSnapshot(makeCtx(tmpDir), {
            source: "bright",
            resource: "intake",
            fromTs: "2026-08-27T21:00:00.000Z",
        });
        expect(out.records.map((r) => r.payload)).toEqual(["kept"]);
    });
});
