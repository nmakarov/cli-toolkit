import { afterEach, describe, expect, it, vi } from "vitest";
import {
    listServicesRegistry,
    registerInServicesRegistry,
    setGroupMaxInstancesDefaults,
    touchServicesRegistry,
    unregisterServicesRegistry,
    updateServicesRegistryMetadata,
} from "../servicesRegistry.js";

afterEach(() => {
    setGroupMaxInstancesDefaults(null);
});

function makeRegistryDb({ existing = null, occupied = [], insertError = null, insertRow = { id: "row-1", service_name: "alpha-host-1" } } = {}) {
    const state = { existing, occupied, updates: [], inserts: [], deletes: [] };
    const chain = {
        where: vi.fn(() => chain),
        whereNot: vi.fn(() => chain),
        where: vi.fn((arg) => {
            if (typeof arg === "string" && arg === "last_seen_at") return chain;
            return chain;
        }),
        first: vi.fn(async () => {
            if (chain._mode === "count") return { count: state.occupied.length };
            return state.existing;
        }),
        count: vi.fn(() => {
            chain._mode = "count";
            return chain;
        }),
        select: vi.fn(async () => state.occupied.map((n) => ({ instance_number: n }))),
        insert: vi.fn((row) => {
            state.inserts.push(row);
            const q = {
                returning: async () => {
                    if (insertError) throw insertError;
                    return [insertRow];
                },
            };
            return q;
        }),
        update: vi.fn(async (patch) => {
            state.updates.push(patch);
            return 1;
        }),
        delete: vi.fn(async () => {
            state.deletes.push(true);
            return 1;
        }),
        fn: { now: () => new Date() },
    };
    // last_seen_at ">" is a second where()
    const origWhere = chain.where;
    chain.where = vi.fn((...args) => {
        chain._mode = undefined;
        return origWhere(...args) || chain;
    });
    const db = vi.fn(() => chain);
    db.fn = { now: () => new Date() };
    return { db, state, chain };
}

describe("servicesRegistry", () => {
    it("requires context.db", async () => {
        await expect(listServicesRegistry({}, { queueName: "tasks" })).rejects.toThrow(/context.db/);
    });

    it("registers a new row and heartbeats", async () => {
        const { db, state } = makeRegistryDb();
        const logger = { info: vi.fn(), warn: vi.fn() };
        const context = { db, logger };
        const reg = await registerInServicesRegistry(context, {
            queueName: "tasks",
            serviceGroup: "alpha",
            staleMs: 45_000,
            target: "alpha",
            metadata: { role: "worker" },
        });
        expect(reg.serviceGroup).toBe("alpha");
        expect(reg.rowId).toBe("row-1");
        expect(state.inserts).toHaveLength(1);

        await touchServicesRegistry(context, reg);
        expect(state.updates.length).toBeGreaterThan(0);

        await updateServicesRegistryMetadata(context, reg, { paused: true });
        await unregisterServicesRegistry(context, reg);
        expect(state.deletes).toHaveLength(1);
    });

    it("takes over a stale row and rejects an alive name", async () => {
        const stale = {
            id: "stale-1",
            last_seen_at: new Date(Date.now() - 120_000).toISOString(),
        };
        const { db } = makeRegistryDb({ existing: stale });
        const logger = { info: vi.fn(), warn: vi.fn() };
        const reg = await registerInServicesRegistry(
            { db, logger },
            { queueName: "tasks", serviceGroup: "alpha", serviceName: "alpha-1", staleMs: 45_000 },
        );
        expect(reg.rowId).toBe("stale-1");

        const alive = {
            id: "live-1",
            last_seen_at: new Date().toISOString(),
        };
        const live = makeRegistryDb({ existing: alive });
        await expect(
            registerInServicesRegistry(
                { db: live.db, logger },
                { queueName: "tasks", serviceGroup: "alpha", serviceName: "alpha-1", staleMs: 45_000 },
            ),
        ).rejects.toThrow(/already registered/);
    });

    it("enforces group max when injected", async () => {
        setGroupMaxInstancesDefaults({ alpha: 1 });
        const { db } = makeRegistryDb({ occupied: [1] });
        await expect(
            registerInServicesRegistry(
                { db, logger: { warn: vi.fn(), info: vi.fn() } },
                { queueName: "tasks", serviceGroup: "alpha", staleMs: 45_000, enforceMaxInstances: true },
            ),
        ).rejects.toThrow(/group limit reached/);
    });

    it("lists alive rows", async () => {
        const rows = [{ service_name: "a", last_seen_at: new Date() }];
        const chain = {
            where: vi.fn(() => chain),
            select: vi.fn(() => chain),
            orderBy: vi.fn(() => chain),
            then: (resolve) => resolve(rows),
        };
        const db = vi.fn(() => chain);
        const listed = await listServicesRegistry({ db }, { queueName: "tasks", serviceGroup: "alpha", staleMs: 45_000 });
        expect(listed).toEqual(rows);
    });
});
