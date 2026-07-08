import { describe, it, expect } from "vitest";
import {
    ensureExtension,
    ensureTable,
    ensureIndex,
    ensureSchema,
    ensureSchemaEverywhere,
} from "../ensure.js";

/**
 * Fake Db handle: enough surface for the ensure helpers (tableExists,
 * schema.hasColumn/createTable/alterTable, raw) with an inspectable state.
 * `tables` maps tableName -> array of column names.
 */
function makeFakeDb({ name = "testdb", tables = {}, indexes = [] } = {}) {
    const rawCalls = [];
    const chain = new Proxy(function () {}, {
        get: (_t, prop) => {
            if (prop === "then") return undefined; // not a thenable
            return () => chain;
        },
        apply: () => chain,
    });
    const columnTypes = ["uuid", "text", "timestamp", "integer", "bigint", "jsonb", "json", "boolean", "string"];
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

    const db = {
        config: { name, connectionString: `postgresql://u:p@host:5432/${name}` },
        tables,
        indexes,
        rawCalls,
        tableExists: async (t) => t in tables,
        raw: async (sql, bindings) => {
            rawCalls.push({ sql, bindings });
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
    return db;
}

const WIDGETS_SPEC = {
    columns: {
        id: (t, db) => t.uuid("id").primary().defaultTo(db.raw("uuid_generate_v4()")),
        name: (t) => t.text("name").notNullable(),
        weight: (t) => t.integer("weight").defaultTo(0),
    },
    indexes: [{ columns: ["name"], name: "widgets_name_idx" }],
};

describe("ensureTable", () => {
    it("creates a missing table with all columns and indexes", async () => {
        const db = makeFakeDb();
        const actions = await ensureTable(db, "widgets", WIDGETS_SPEC);

        expect(db.tables.widgets).toEqual(["id", "name", "weight"]);
        expect(db.indexes).toContain("widgets_name_idx");
        expect(actions.some((a) => a.startsWith("CREATE TABLE widgets"))).toBe(true);
    });

    it("adds only the missing columns to an existing table", async () => {
        const db = makeFakeDb({ tables: { widgets: ["id", "name"] }, indexes: ["widgets_name_idx"] });
        const actions = await ensureTable(db, "widgets", WIDGETS_SPEC);

        expect(db.tables.widgets).toEqual(["id", "name", "weight"]);
        expect(actions).toEqual(["ALTER TABLE widgets ADD COLUMN weight"]);
    });

    it("no-ops when table, columns, and indexes are all present", async () => {
        const db = makeFakeDb({
            tables: { widgets: ["id", "name", "weight"] },
            indexes: ["widgets_name_idx"],
        });
        const actions = await ensureTable(db, "widgets", WIDGETS_SPEC);
        expect(actions).toEqual([]);
    });

    it("dryRun reports the plan without touching the database", async () => {
        const db = makeFakeDb({ tables: { widgets: ["id"] } });
        const actions = await ensureTable(db, "widgets", WIDGETS_SPEC, { dryRun: true });

        expect(actions.some((a) => a.includes("ADD COLUMN name, weight"))).toBe(true);
        expect(db.tables.widgets).toEqual(["id"]); // unchanged
        expect(db.indexes).toEqual([]); // index not created
    });
});

describe("ensureIndex", () => {
    it("skips indexes that already exist (pg catalog check)", async () => {
        const db = makeFakeDb({ tables: { widgets: ["id"] }, indexes: ["widgets_name_idx"] });
        const actions = await ensureIndex(db, "widgets", { columns: ["name"], name: "widgets_name_idx" });
        expect(actions).toEqual([]);
    });

    it("creates UNIQUE indexes when asked", async () => {
        const db = makeFakeDb({ tables: { widgets: ["id"] } });
        const actions = await ensureIndex(db, "widgets", {
            columns: ["a", "b"],
            name: "widgets_ab_uniq",
            unique: true,
        });
        expect(actions[0]).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS "widgets_ab_uniq"/);
        expect(db.indexes).toContain("widgets_ab_uniq");
    });
});

describe("ensureExtension", () => {
    it("issues CREATE EXTENSION IF NOT EXISTS", async () => {
        const db = makeFakeDb();
        await ensureExtension(db, "uuid-ossp");
        expect(db.rawCalls.some((c) => c.sql === `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)).toBe(true);
    });

    it("dryRun does not execute", async () => {
        const db = makeFakeDb();
        await ensureExtension(db, "uuid-ossp", { dryRun: true });
        expect(db.rawCalls).toEqual([]);
    });
});

describe("ensureSchema / ensureSchemaEverywhere", () => {
    const spec = { extensions: ["uuid-ossp"], tables: { widgets: WIDGETS_SPEC } };

    it("applies a full spec to one database", async () => {
        const db = makeFakeDb({ name: "main" });
        const report = await ensureSchema(db, spec);
        expect(report.database).toBe("main");
        expect(db.tables.widgets).toBeDefined();
        expect(report.actions.length).toBeGreaterThan(0);
    });

    it("applies the same spec to many databases, each getting only what it lacks", async () => {
        const fresh = makeFakeDb({ name: "src_a" });
        const partial = makeFakeDb({
            name: "src_b",
            tables: { widgets: ["id", "name"] },
            indexes: ["widgets_name_idx"],
        });
        const complete = makeFakeDb({
            name: "src_c",
            tables: { widgets: ["id", "name", "weight"] },
            indexes: ["widgets_name_idx"],
        });

        const reports = await ensureSchemaEverywhere([fresh, partial, complete], spec);

        expect(reports.map((r) => r.database)).toEqual(["src_a", "src_b", "src_c"]);
        expect(reports[0].actions.some((a) => a.startsWith("CREATE TABLE"))).toBe(true);
        expect(reports[1].actions).toEqual(["ALTER TABLE widgets ADD COLUMN weight"]);
        expect(reports[2].actions).toEqual([]);
        expect(fresh.tables.widgets).toEqual(["id", "name", "weight"]);
        expect(partial.tables.widgets).toEqual(["id", "name", "weight"]);
    });
});
