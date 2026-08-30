import { describe, expect, it } from "vitest";
import { sleepMs, toJsonColumn } from "../core-utils.js";

describe("core-utils", () => {
    it("sleepMs resolves and toJsonColumn stringifies", async () => {
        const t0 = Date.now();
        await sleepMs(5);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(0);
        expect(toJsonColumn(null)).toBe(null);
        expect(toJsonColumn(undefined)).toBe(null);
        expect(toJsonColumn({ a: 1 })).toBe('{"a":1}');
    });
});
