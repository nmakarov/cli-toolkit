import { afterEach, describe, expect, it } from "vitest";
import {
    resolveGroupMaxInstances,
    setGroupMaxInstancesDefaults,
} from "../servicesRegistry.js";

afterEach(() => {
    setGroupMaxInstancesDefaults(null);
});

describe("setGroupMaxInstancesDefaults", () => {
    it("treats unknown groups as unlimited (0) until a map is injected", () => {
        expect(resolveGroupMaxInstances("intake")).toBe(0);
        expect(resolveGroupMaxInstances("custom")).toBe(0);
    });

    it("uses the injected per-group map", () => {
        setGroupMaxInstancesDefaults({ intake: 1, harvest: 1, loader: 0 });
        expect(resolveGroupMaxInstances("intake")).toBe(1);
        expect(resolveGroupMaxInstances("HARVEST")).toBe(1);
        expect(resolveGroupMaxInstances("loader")).toBe(0);
        expect(resolveGroupMaxInstances("other")).toBe(0);
    });

    it("lets an explicit override win", () => {
        setGroupMaxInstancesDefaults({ intake: 1 });
        expect(resolveGroupMaxInstances("intake", 4)).toBe(4);
        expect(resolveGroupMaxInstances("intake", 0)).toBe(0);
        expect(resolveGroupMaxInstances("intake", 1.9)).toBe(1);
    });

    it("clears the map when set to null", () => {
        setGroupMaxInstancesDefaults({ intake: 1 });
        expect(resolveGroupMaxInstances("intake")).toBe(1);
        setGroupMaxInstancesDefaults(null);
        expect(resolveGroupMaxInstances("intake")).toBe(0);
    });
});
