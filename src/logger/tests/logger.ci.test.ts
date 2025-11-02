import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliToolkitLogger } from "../index.js";
import { ConsoleFallbackLogger } from "../fallback.js";

describe("Logger CI", () => {
    const consoleInfo = vi.spyOn(console, "info");
    const consoleWarn = vi.spyOn(console, "warn");
    const consoleDebug = vi.spyOn(console, "debug");
    const consoleError = vi.spyOn(console, "error");

    beforeEach(() => {
        consoleInfo.mockReset();
        consoleWarn.mockReset();
        consoleDebug.mockReset();
        consoleError.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("fallback logger proxies to console", () => {
        const fallback = new ConsoleFallbackLogger();
        fallback.debug("debug-message");
        fallback.warn("warn-message");
        fallback.error("error-message");

        expect(consoleDebug).toHaveBeenCalledWith("debug-message");
        expect(consoleWarn).toHaveBeenCalledWith("warn-message");
        expect(consoleError).toHaveBeenCalledWith("error-message");
    });

    it("filters levels, applies prefix and timestamp in text mode", () => {
        const logger = new CliToolkitLogger({
            prefix: "WORKER",
            timestamp: true,
            levels: ["info", "error"],
            progress: { withTimes: true },
            route: "console"
        });

        logger.info("starting", { task: 123 });
        logger.debug("should not appear");
        logger.error("failed");

        expect(consoleInfo).toHaveBeenCalledTimes(2);
        const [firstCall, secondCall] = consoleInfo.mock.calls as string[][];
        expect(firstCall[0]).toContain("INFO");
        expect(firstCall[0]).toContain("starting");
        expect(firstCall[0]).toContain("WORKER");
        expect(firstCall[0]).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp prefix
        expect(firstCall[0]).toMatch(/task.*123/);

        expect(secondCall[0]).toContain("ERROR");
        expect(secondCall[0]).toContain("failed");
    });

    it("emits JSON mode payloads", () => {
        const logger = new CliToolkitLogger({ mode: "json", showLevel: false, route: "console" });
        logger.notice("json-test", { data: 42 });

        expect(consoleInfo).toHaveBeenCalledTimes(1);
        const payload = consoleInfo.mock.calls[0][0];
        expect(payload).toMatchObject({
            level: "notice",
            message: "json-test"
        });
        expect(Array.isArray(payload.chunks)).toBe(true);
    });

    it("routes to parent process when available", () => {
        const sendMock = vi.fn();
        const originalSend = process.send;
        // @ts-expect-error - assigning mock for test
        process.send = sendMock;

        try {
            const logger = new CliToolkitLogger({ route: "ipc" });
            logger.info("ipc-message");
            expect(sendMock).toHaveBeenCalled();
            expect(consoleInfo).not.toHaveBeenCalled();
        } finally {
            // @ts-expect-error - restore original type
            process.send = originalSend;
        }
    });

    it("throttles progress output and computes elapsed/remaining", () => {
        vi.useFakeTimers();
        const logger = new CliToolkitLogger({
            progress: { withTimes: true, throttleMs: 1000 },
            route: "console"
        });

        logger.progress("work", { prefix: "task", count: 1, total: 5 });
        vi.advanceTimersByTime(400);
        logger.progress("work", { prefix: "task", count: 2, total: 5 });
        vi.advanceTimersByTime(600);
        logger.progress("work", { prefix: "task", count: 3, total: 5 });
        vi.advanceTimersByTime(1000);
        logger.progress("work", { prefix: "task", count: 4, total: 5 });
        logger.progress("work", { prefix: "task", count: 5, total: 5 });

        // Should print first call, third (after throttle), fourth (after throttle), and final
        expect(consoleInfo.mock.calls.length).toBeGreaterThanOrEqual(3);
        consoleInfo.mock.calls.forEach(call => {
            expect(call[0]).toContain("task");
            expect(call[0]).toContain("PROGRESS");
        });
    });

    it("handles request/response inspection", () => {
        const logger = new CliToolkitLogger({ route: "console" });
        logger.request("op1", { payload: true });
        logger.response("op2", "done");

        expect(consoleInfo).toHaveBeenCalledTimes(2);
        expect(consoleInfo.mock.calls[0][0]).toContain("REQUEST");
        expect(consoleInfo.mock.calls[1][0]).toContain("RESPONSE");
    });

    it("handles silenced output", () => {
        const logger = new CliToolkitLogger({ silent: true });
        logger.info("should-not-log");
        expect(consoleInfo).not.toHaveBeenCalled();
    });

    it("supports dynamic mode switching", () => {
        const logger = new CliToolkitLogger({ mode: "text", route: "console" });
        logger.setMode("json");
        logger.info("json-switch");
        expect(consoleInfo.mock.calls[0][0]).toMatchObject({ level: "info", message: "json-switch" });
    });
});


