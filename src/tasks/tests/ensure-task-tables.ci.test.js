import { describe, it, expect, vi } from "vitest";
import { ensureTaskTables, tasksSchemaSpec, queueToTableNames } from "../taskUtils.js";

/** Same fake-Db harness as the db/ensure tests: tables maps name -> columns. */
function makeFakeDb({ name = "testdb", tables = {}, indexes = [] } = {}) {
    const chain = new Proxy(function () {}, {
        get: (_t, prop) => (prop === "then" ? undefined : () => chain),
        apply: () => chain,
    });
    const columnTypes = ["uuid", "text", "timestamp", "integer", "jsonb", "json", "boolean"];
    const makeT = (collected) =>
        new Proxy(
            {},
            {
                get: (_t, method) => (...args) => {
                    if (columnTypes.includes(String(method)) && typeof args[0] === "string") {
                        collected.push(args[0]);
                    }
                    return chain;
                },
            },
        );

    return {
        config: { name, connectionString: `postgresql://u:p@host:5432/${name}` },
        tables,
        indexes,
        tableExists: async (t) => t in tables,
        raw: async (sql, bindings) => {
            if (/pg_indexes/.test(sql)) {
                return { rows: indexes.includes(bindings?.[0]) ? [{ found: 1 }] : [] };
            }
            if (/^CREATE (UNIQUE )?INDEX/.test(sql)) {
                const m = /"([^"]+)"/.exec(sql);
                if (m) indexes.push(m[1]);
            }
            return { rows: [] };
        },
        schema: {
            hasColumn: async (t, c) => (tables[t] ?? []).includes(c),
            createTable: async (t, cb) => {
                const cols = [];
                cb(makeT(cols));
                tables[t] = cols;
            },
            alterTable: async (t, cb) => {
                const cols = [];
                cb(makeT(cols));
                tables[t] = [...(tables[t] ?? []), ...cols];
            },
            dropTableIfExists: async (t) => {
                delete tables[t];
            },
        },
        fn: { now: () => "now()" },
    };
}

function makeContext(db) {
    return {
        db,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), silly: vi.fn() },
    };
}

describe("tasksSchemaSpec", () => {
    it("describes the three tables of a queue with their key columns", () => {
        const spec = tasksSchemaSpec("myqueue");
        expect(Object.keys(spec.tables)).toEqual(["myqueue", "myqueue_history", "myqueue_services_registry"]);
        expect(Object.keys(spec.tables.myqueue.columns)).toContain("priority");
        expect(Object.keys(spec.tables.myqueue.columns)).toContain("next_run_at");
        expect(spec.tables.myqueue_services_registry.indexes.some((i) => i.unique)).toBe(true);
        expect(spec.extensions).toContain("uuid-ossp");
    });
});

describe("ensureTaskTables", () => {
    it("creates all three tables on a fresh database", async () => {
        const db = makeFakeDb();
        await ensureTaskTables(makeContext(db), { queueName: "tasks" });

        const { tasksTable, historyTable, registryTable } = queueToTableNames("tasks");
        expect(db.tables[tasksTable]).toContain("id");
        expect(db.tables[tasksTable]).toContain("params");
        expect(db.tables[historyTable]).toContain("results");
        expect(db.tables[registryTable]).toContain("last_seen_at");
        expect(db.indexes).toContain("tasks_claim_idx");
        expect(db.indexes).toContain("tasks_history_completed_at_idx");
        expect(db.indexes).toContain("tasks_services_registry_queue_name_service_name_uniq");
    });

    it("adds missing columns to tables created by an older version", async () => {
        // An old install: tasks table without the newer scheduling columns.
        const oldColumns = ["id", "created_at", "name", "params", "status"];
        const db = makeFakeDb({
            tables: {
                tasks: [...oldColumns],
                tasks_history: [...oldColumns],
                tasks_services_registry: ["id", "queue_name", "service_group", "instance_number",
                    "service_name", "server_name", "pid", "metadata", "created_at", "last_seen_at"],
            },
            indexes: [
                "tasks_claim_idx", "tasks_group_name_idx",
                "tasks_history_claim_idx", "tasks_history_group_name_idx",
                "tasks_services_registry_queue_name_service_name_uniq",
                "tasks_services_registry_queue_group_seen_idx",
                "tasks_services_registry_queue_seen_idx",
            ],
        });
        await ensureTaskTables(makeContext(db), { queueName: "tasks" });

        expect(db.tables.tasks).toContain("schedule");
        expect(db.tables.tasks).toContain("next_run_at");
        expect(db.tables.tasks).toContain("past_due");
        expect(db.tables.tasks_history).toContain("progress");
        // untouched columns still there, nothing dropped
        expect(db.tables.tasks).toEqual(expect.arrayContaining(oldColumns));
    });

    it("applies to MANY databases when options.databases is given", async () => {
        const main = makeFakeDb({ name: "main" });
        const srcA = makeFakeDb({ name: "src_a" });
        const srcB = makeFakeDb({ name: "src_b", tables: { tasks: ["id", "name"] } });

        // context.db deliberately different — databases option wins.
        await ensureTaskTables(makeContext(makeFakeDb({ name: "ignored" })), {
            queueName: "tasks",
            databases: [main, srcA, srcB],
        });

        for (const db of [main, srcA, srcB]) {
            expect(db.tables.tasks).toContain("params");
            expect(db.tables.tasks_history).toBeDefined();
            expect(db.tables.tasks_services_registry).toBeDefined();
        }
        // src_b had a partial tasks table — got column-level upgrades, not a recreate
        expect(srcB.tables.tasks).toEqual(expect.arrayContaining(["id", "name", "priority", "results"]));
    });

    it("recreate drops and recreates", async () => {
        const db = makeFakeDb({ tables: { tasks: ["id", "old_junk"] } });
        await ensureTaskTables(makeContext(db), { queueName: "tasks", recreate: true });
        expect(db.tables.tasks).not.toContain("old_junk");
        expect(db.tables.tasks).toContain("params");
    });

    it("dryRun reports but does not touch any database", async () => {
        const db = makeFakeDb({ tables: { tasks: ["id"] } });
        const context = makeContext(db);
        await ensureTaskTables(context, { queueName: "tasks", dryRun: true });

        expect(db.tables.tasks).toEqual(["id"]); // unchanged
        expect(db.tables.tasks_history).toBeUndefined();
        const logged = context.logger.info.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(logged).toMatch(/would run \d+ statement/);
    });
});
