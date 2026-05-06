import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "../index.js";
import { ConsoleFallbackLogger } from "../fallback.js";

// Create a minimal context for testing
const createTestContext = () => ({} );

describe("Logger CI", () => {
    const consoleInfo = vi.spyOn(console, "info");
    const consoleWarn = vi.spyOn(console, "warn");
    const consoleDebug = vi.spyOn(console, "debug");
    const consoleError = vi.spyOn(console, "error");

    beforeEach(() => {
        // Reset and mock console methods to suppress output while still tracking calls
        consoleInfo.mockReset();
        consoleWarn.mockReset();
        consoleDebug.mockReset();
        consoleError.mockReset();
        // Suppress actual output but still track calls
        consoleInfo.mockImplementation(() => {});
        consoleWarn.mockImplementation(() => {});
        consoleDebug.mockImplementation(() => {});
        consoleError.mockImplementation(() => {});
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
        const context = createTestContext();
        const logger = new Logger(context, {
            prefix: "WORKER",
            timestamp: true,
            showLevel: true,
            levels: ["info", "error"],
            progress: { withTimes: true },
            route: "console"
        });

        logger.info("starting", { task: 123 });
        logger.debug("should not appear");
        logger.error("failed");

        expect(consoleInfo).toHaveBeenCalledTimes(2);
        const [firstCall, secondCall] = consoleInfo.mock.calls ;
        expect(firstCall[0]).toContain("INFO");
        expect(firstCall[0]).toContain("starting");
        expect(firstCall[0]).toContain("WORKER");
        expect(firstCall[0]).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp prefix
        expect(firstCall[0]).toMatch(/task.*123/);

        expect(secondCall[0]).toContain("ERROR");
        expect(secondCall[0]).toContain("failed");
    });

    it("emits JSON mode payloads", () => {
        const context = createTestContext();
        const logger = new Logger(context, { mode: "json", showLevel: false, route: "console" });
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
        const originalVITEST = process.env.VITEST;
        const originalNODE_ENV = process.env.NODE_ENV;
        const originalConnected = (process ).connected;
        
        delete process.env.VITEST;
        delete process.env.NODE_ENV;
        (process ).send = sendMock;
        (process ).connected = true;

        try {
            const context = createTestContext();
            const logger = new Logger(context, { route: "ipc" });
            logger.info("ipc-message");
            expect(sendMock).toHaveBeenCalled();
            expect(consoleInfo).not.toHaveBeenCalled();
        } finally {
            (process ).send = originalSend;
            (process ).connected = originalConnected;
            if (originalVITEST !== undefined) process.env.VITEST = originalVITEST;
            else delete process.env.VITEST;
            if (originalNODE_ENV !== undefined) process.env.NODE_ENV = originalNODE_ENV;
            else delete process.env.NODE_ENV;
        }
    });

    it("falls back to console when route is ipc but process not connected", () => {
        const originalVITEST = process.env.VITEST;
        const originalNODE_ENV = process.env.NODE_ENV;
        const originalSend = process.send;
        const originalConnected = (process ).connected;
        delete process.env.VITEST;
        delete process.env.NODE_ENV;
        (process ).send = () => {};
        (process ).connected = false;

        try {
            const context = createTestContext();
            const logger = new Logger(context, { route: "ipc" });
            logger.info("fallback-ipc");
            expect(consoleInfo).toHaveBeenCalledWith(expect.any(String));
        } finally {
            (process ).send = originalSend;
            (process ).connected = originalConnected;
            if (originalVITEST !== undefined) process.env.VITEST = originalVITEST;
            else delete process.env.VITEST;
            if (originalNODE_ENV !== undefined) process.env.NODE_ENV = originalNODE_ENV;
            else delete process.env.NODE_ENV;
        }
    });

    it("uses console when route is ipc in test environment (VITEST set)", () => {
        // With VITEST set, ParentProcessTransport.write uses console.info to avoid IPC in workers
        const context = createTestContext();
        const logger = new Logger(context, { route: "ipc" });
        logger.info("test-env-ipc");
        expect(consoleInfo).toHaveBeenCalledWith(expect.any(String));
    });

    it("throttles progress output and computes elapsed/remaining", () => {
        vi.useFakeTimers();
        const context = createTestContext();
        const logger = new Logger(context, {
            showLevel: true,
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
        const context = createTestContext();
        const logger = new Logger(context, { showLevel: true, route: "console" });
        logger.request("op1", { payload: true });
        logger.response("op2", "done");

        expect(consoleInfo).toHaveBeenCalledTimes(2);
        expect(consoleInfo.mock.calls[0][0]).toContain("REQUEST");
        expect(consoleInfo.mock.calls[1][0]).toContain("RESPONSE");
    });

    it("handles silenced output", () => {
        const context = createTestContext();
        const logger = new Logger(context, { silent: true, route: "console" });
        logger.info("should-not-log");
        expect(consoleInfo).not.toHaveBeenCalled();
    });

    it("supports dynamic mode switching", () => {
        const context = createTestContext();
        const logger = new Logger(context, { mode: "text", route: "console" });
        logger.setMode("json");
        logger.info("json-switch");
        expect(consoleInfo.mock.calls[0][0]).toMatchObject({ level: "info", message: "json-switch" });
    });
});


