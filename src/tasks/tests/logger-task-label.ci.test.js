import { afterEach, describe, expect, it } from "vitest";
import { loggerTaskLabel, setLoggerTaskLabelResolver } from "../taskUtils.js";

afterEach(() => {
    setLoggerTaskLabelResolver(null);
});

describe("loggerTaskLabel", () => {
    it("defaults to name, or name:source, and prefers params.logTask", () => {
        expect(loggerTaskLabel({ name: "hostInfo" })).toBe("hostInfo");
        expect(loggerTaskLabel({ name: "parentTask", params: { source: "alpha" } })).toBe(
            "parentTask:alpha",
        );
        expect(
            loggerTaskLabel({
                name: "childTask",
                params: JSON.stringify({ source: "alpha", resource: "items", logTask: "parentTask:alpha" }),
            }),
        ).toBe("parentTask:alpha");
        expect(loggerTaskLabel({})).toBe("task");
    });

    it("uses an injected resolver when logTask is absent", () => {
        setLoggerTaskLabelResolver((row, { name }) => {
            if (name === "childTask") {
                const m = String(row?.opid ?? "").match(/^parent:([^:]+)/);
                return m ? `parentTask:${m[1]}` : null;
            }
            return null;
        });
        expect(
            loggerTaskLabel({
                name: "childTask",
                opid: "parent:alpha:abc",
                params: { source: "alpha", resource: "items" },
            }),
        ).toBe("parentTask:alpha");
        expect(loggerTaskLabel({ name: "parentTask", params: { source: "alpha" } })).toBe(
            "parentTask:alpha",
        );
    });

    it("ignores a blank resolver result and falls back to name:source", () => {
        setLoggerTaskLabelResolver(() => "   ");
        expect(loggerTaskLabel({ name: "childTask", params: { source: "alpha" } })).toBe(
            "childTask:alpha",
        );
    });

    it("clears the resolver when set to null", () => {
        setLoggerTaskLabelResolver(() => "injected");
        expect(loggerTaskLabel({ name: "x" })).toBe("injected");
        setLoggerTaskLabelResolver(null);
        expect(loggerTaskLabel({ name: "x" })).toBe("x");
    });
});
