import { describe, it, expect, beforeEach, vi } from "vitest";
import { Db, replaceDatabaseName } from "../index.js";
import { ParamError } from "../../errors.js";

// Mock knex — the sibling tests never touch a real server.
vi.mock("knex", () => {
    const makeInstance = () => {
        const instance = vi.fn(() => ({}));
        instance.raw = vi.fn().mockResolvedValue({ rows: [{ result: 5 }] });
        instance.schema = { hasTable: vi.fn().mockResolvedValue(true) };
        instance.on = vi.fn();
        instance.destroy = vi.fn().mockResolvedValue(undefined);
        return instance;
    };
    const mockKnex = vi.fn(() => makeInstance());
    return { default: mockKnex };
});

import knex from "knex";
const mockKnex = knex;

const BASE = "postgresql://user:pass@dbhost:6032/maindb";

function makeContext({ params = {}, withMainDb = true, databasesOnServer } = {}) {
    const context = {
        params: {
            get: vi.fn(async (name) => params[name]),
            getAllForModule: vi.fn(() => ({})),
        },
        logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
        registerCleanup: vi.fn(),
    };
    if (withMainDb) {
        // Enough of a Db handler for initSibling: base connection string plus
        // the pg_database existence/scan query. By default every asked-for
        // database "exists"; pass databasesOnServer to control it.
        context.db = {
            config: { connectionString: BASE, name: "maindb" },
            raw: vi.fn(async (sql, bindings) => {
                if (databasesOnServer) {
                    if (/datname = \?/.test(sql)) {
                        return { rows: databasesOnServer.includes(bindings?.[0]) ? [{ found: 1 }] : [] };
                    }
                    return { rows: databasesOnServer.map((datname) => ({ datname })) };
                }
                return { rows: [{ found: 1 }] };
            }),
        };
    }
    return context;
}

describe("replaceDatabaseName", () => {
    it("swaps only the database name", () => {
        expect(replaceDatabaseName(BASE, "src_bright")).toBe(
            "postgresql://user:pass@dbhost:6032/src_bright"
        );
    });

    it("keeps query options (sslmode etc.) intact", () => {
        expect(
            replaceDatabaseName("postgresql://u:p@h:5432/db?sslmode=require", "src_x")
        ).toBe("postgresql://u:p@h:5432/src_x?sslmode=require");
    });

    it("rejects unparseable strings", () => {
        expect(() => replaceDatabaseName("not a url", "x")).toThrow(ParamError);
    });
});

describe("Db.initSibling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("derives the connection string from context.db", async () => {
        const context = makeContext();
        await Db.initSibling(context, "src_bright");

        expect(mockKnex).toHaveBeenCalledTimes(1);
        const knexConfig = mockKnex.mock.calls[0][0];
        expect(knexConfig.connection.connectionString).toBe(
            "postgresql://user:pass@dbhost:6032/src_bright"
        );
    });

    it("prefers the explicit SIB_ override param when set", async () => {
        const context = makeContext({
            params: {
                dbConnectionStringSibSrcBright: "postgresql://other:secret@elsewhere:5432/src_bright",
            },
        });
        await Db.initSibling(context, "src_bright");

        const knexConfig = mockKnex.mock.calls[0][0];
        expect(knexConfig.connection.connectionString).toBe(
            "postgresql://other:secret@elsewhere:5432/src_bright"
        );
        // Override wins even though context.db exists.
        expect(context.params.get).toHaveBeenCalledWith("dbConnectionStringSibSrcBright", "string");
    });

    it("SIB_ override skips the existence check (sibling lives on another server)", async () => {
        const context = makeContext({
            databasesOnServer: ["maindb"], // src_bright NOT on the base server
            params: {
                dbConnectionStringSibSrcBright: "postgresql://other:secret@elsewhere:5432/src_bright",
            },
        });
        const handler = await Db.initSibling(context, "src_bright");
        expect(handler).not.toBe(context.db);
        expect(handler.config.name).toBe("src_bright");
    });

    it("accepts options.baseDb / options.baseConnectionString instead of context.db", async () => {
        const context = makeContext({ withMainDb: false });
        await Db.initSibling(context, "src_a", {
            baseConnectionString: "postgresql://x:y@base:1111/whatever",
        });
        // With only a connection string, the existence check uses a short-lived
        // connection first; the sibling connect is the most recent knex call.
        const lastCall = () => mockKnex.mock.calls[mockKnex.mock.calls.length - 1][0];
        expect(lastCall().connection.connectionString).toBe("postgresql://x:y@base:1111/src_a");

        const baseDb = {
            config: { connectionString: "postgresql://x:y@base2:2222/whatever" },
            raw: vi.fn(async () => ({ rows: [{ found: 1 }] })),
        };
        await Db.initSibling(context, "src_b", { baseDb });
        expect(lastCall().connection.connectionString).toBe("postgresql://x:y@base2:2222/src_b");
    });

    it("caches handlers per name on the context (one pool per sibling)", async () => {
        const context = makeContext();
        const first = await Db.initSibling(context, "src_bright");
        const again = await Db.initSibling(context, "src_bright");
        const other = await Db.initSibling(context, "src_actris");

        expect(again).toBe(first);
        expect(other).not.toBe(first);
        expect(mockKnex).toHaveBeenCalledTimes(2); // not 3
        expect(context.siblingDbs.size).toBe(2);
    });

    it("registers cleanup for each sibling", async () => {
        const context = makeContext();
        await Db.initSibling(context, "src_bright");
        expect(context.registerCleanup).toHaveBeenCalledTimes(1);
    });

    it("fails clearly when there is no base to derive from", async () => {
        const context = makeContext({ withMainDb: false });
        await expect(Db.initSibling(context, "src_bright")).rejects.toThrow(
            /no base connection to derive/
        );
        await expect(Db.initSibling(context, "src_bright")).rejects.toThrow(
            /DB_CONNECTION_STRING_SIB_SRC_BRIGHT/
        );
    });

    it("rejects unsafe database names", async () => {
        const context = makeContext();
        await expect(Db.initSibling(context, "bad;name")).rejects.toThrow(/invalid sibling/);
        await expect(Db.initSibling(context, "with space")).rejects.toThrow(/invalid sibling/);
    });

    it("empty name returns the main handler (location-agnostic call sites)", async () => {
        const context = makeContext();
        expect(await Db.initSibling(context, "")).toBe(context.db);
        expect(await Db.initSibling(context, undefined)).toBe(context.db);
        expect(mockKnex).not.toHaveBeenCalled(); // no new connection
    });

    it("falls back to the main handler when the sibling DB does not exist yet", async () => {
        const context = makeContext({ databasesOnServer: ["maindb", "src_migrated"] });

        const notMigrated = await Db.initSibling(context, "src_pending");
        expect(notMigrated).toBe(context.db);
        expect(mockKnex).not.toHaveBeenCalled();

        const migrated = await Db.initSibling(context, "src_migrated");
        expect(migrated).not.toBe(context.db);
        expect(migrated.config.name).toBe("src_migrated");

        // The fallback answer is cached too — no repeated existence checks.
        const rawCallsBefore = context.db.raw.mock.calls.length;
        const again = await Db.initSibling(context, "src_pending");
        expect(again).toBe(context.db);
        expect(context.db.raw.mock.calls.length).toBe(rawCallsBefore);
    });

    it("sets the sibling name as the handler display name", async () => {
        const context = makeContext();
        const handler = await Db.initSibling(context, "src_bright");
        expect(handler.config.name).toBe("src_bright");
    });
});

describe("Db.discoverSiblings", () => {
    it("requires a prefix or a match", async () => {
        await expect(Db.discoverSiblings(makeContext(), {})).rejects.toThrow(/prefix|match/);
    });

    it("finds same-server databases matching the prefix", async () => {
        const context = makeContext({
            databasesOnServer: ["postgres", "maindb", "src_bright", "src_mred"],
        });
        const found = await Db.discoverSiblings(context, { prefix: "src_", env: {} });
        expect(found).toEqual([
            { name: "src_bright", origin: "server" },
            { name: "src_mred", origin: "server" },
        ]);
    });

    it("finds env-declared siblings (SIB_ namespace) and merges, env wins", async () => {
        const context = makeContext({ databasesOnServer: ["src_bright"] });
        const env = {
            DB_CONNECTION_STRING_SIB_SRC_BRIGHT: "postgresql://x@other-server:5432/src_bright",
            DB_CONNECTION_STRING_SIB_SRC_ACTRIS: "postgresql://x@third-server:5432/src_actris",
            DB_CONNECTION_STRING_LOCAL: "postgresql://x@localhost:5432/maindb", // not in SIB_ namespace
            DB_CONNECTION_STRING_SRC_OLDSTYLE: "postgresql://x@h:1/src_oldstyle", // not in SIB_ namespace
        };
        const found = await Db.discoverSiblings(context, { prefix: "src_", env });
        expect(found).toEqual([
            { name: "src_actris", origin: "env" },
            { name: "src_bright", origin: "env" }, // env beats the server scan
        ]);
    });

    it("accepts a RegExp match instead of a prefix", async () => {
        const context = makeContext({ databasesOnServer: ["src_a", "tenant_b", "other"] });
        const found = await Db.discoverSiblings(context, { match: /^(src|tenant)_/, env: {} });
        expect(found.map((f) => f.name)).toEqual(["src_a", "tenant_b"]);
    });

    it("works without a server connection (env only)", async () => {
        const context = makeContext({ withMainDb: false });
        const env = { DB_CONNECTION_STRING_SIB_SRC_A: "postgresql://x@h:1/src_a" };
        const found = await Db.discoverSiblings(context, { prefix: "src_", env });
        expect(found).toEqual([{ name: "src_a", origin: "env" }]);
    });
});

describe("Db.initAllSiblings", () => {
    it("connects every discovered sibling, optionally prepending the main db", async () => {
        const context = makeContext({ databasesOnServer: ["src_a", "src_b", "maindb"] });

        const siblings = await Db.initAllSiblings(context, { prefix: "src_", env: {} });
        expect(siblings).toHaveLength(2);
        expect(siblings.map((s) => s.config.name)).toEqual(["src_a", "src_b"]);

        const withMain = await Db.initAllSiblings(context, {
            prefix: "src_",
            env: {},
            includeMain: true,
        });
        expect(withMain).toHaveLength(3);
        expect(withMain[0]).toBe(context.db);
        // cached: same handles as the first call
        expect(withMain[1]).toBe(siblings[0]);
    });
});
