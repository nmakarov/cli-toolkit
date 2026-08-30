import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger, formatLog } from "../index.js";
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

    it("does not throw when a level method is called unbound", () => {
        const context = createTestContext();
        const logger = new Logger(context, { mode: "json", showLevel: false, route: "console" });
        expect(() => logger.warn.call(undefined, "unbound")).not.toThrow();
        expect(consoleInfo).not.toHaveBeenCalled();
        logger.warn("bound");
        expect(consoleInfo).toHaveBeenCalled();
    });

    it("emits JSON mode payloads", () => {
        const context = createTestContext();
        const logger = new Logger(context, { mode: "json", showLevel: false, route: "console" });
        logger.notice("json-test", { data: 42 });

        expect(consoleInfo).toHaveBeenCalledTimes(1);
        const raw = consoleInfo.mock.calls[0][0];
        const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
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

        expect(logger.progress("work", { prefix: "task", count: 1, total: 5 })).toBe(true);
        vi.advanceTimersByTime(400);
        expect(logger.progress("work", { prefix: "task", count: 2, total: 5 })).toBe(false);
        vi.advanceTimersByTime(600);
        expect(logger.progress("work", { prefix: "task", count: 3, total: 5 })).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(logger.progress("work", { prefix: "task", count: 4, total: 5 })).toBe(true);
        expect(logger.progress("work", { prefix: "task", count: 5, total: 5 })).toBe(true);

        // Should print first call, third (after throttle), fourth (after throttle), and final
        expect(consoleInfo.mock.calls.length).toBeGreaterThanOrEqual(3);
        consoleInfo.mock.calls.forEach(call => {
            expect(call[0]).toContain("task");
            expect(call[0]).toContain("PROGRESS");
        });
    });

    it("prints items/sec when progressWithRate is enabled", () => {
        vi.useFakeTimers();
        const context = createTestContext();
        const logger = new Logger(context, {
            showLevel: true,
            progress: { withTimes: true, withRate: true, throttleMs: 0 },
            route: "console",
        });

        expect(logger.progress("work", { prefix: "job", count: 1, total: 10 })).toBe(true);
        expect(consoleInfo.mock.calls.at(-1)[0]).toContain("-/s");

        vi.advanceTimersByTime(2000);
        expect(logger.progress("work", { prefix: "job", count: 5, total: 10 })).toBe(true);
        const line = consoleInfo.mock.calls.at(-1)[0];
        // 4 items since first sample in 2s → 2/s
        expect(line).toMatch(/\b2(\.0+)?\/s\b/);
        expect(line).toContain("/"); // elapsed/remaining still present
    });

    it("rates batched progress from the first sample count (not count-1)", () => {
        vi.useFakeTimers();
        const context = createTestContext();
        const logger = new Logger(context, {
            showLevel: true,
            progress: { withTimes: true, withRate: true, throttleMs: 0 },
            route: "console",
        });

        // Loader-style: first report already at 500.
        expect(logger.progress("Loading records", { prefix: "Progress", count: 500, total: 5000 })).toBe(true);
        expect(consoleInfo.mock.calls.at(-1)[0]).toContain("-/s");

        vi.advanceTimersByTime(10000);
        expect(logger.progress("Loading records", { prefix: "Progress", count: 1000, total: 5000 })).toBe(true);
        const line = consoleInfo.mock.calls.at(-1)[0];
        // 500 items in 10s → 50/s (old formula used 999/10 ≈ 99.9/s)
        expect(line).toMatch(/\b50(\.0+)?\/s\b/);
        expect(line).not.toMatch(/\b99/);
    });

    it("keeps rate when count overshoots a stale total, and clamps remaining", () => {
        vi.useFakeTimers();
        const context = createTestContext();
        const logger = new Logger(context, {
            showLevel: true,
            progress: { withTimes: true, withRate: true, throttleMs: 0 },
            route: "console",
        });

        expect(logger.progress("work", { prefix: "job", count: 100, total: 200 })).toBe(true);
        vi.advanceTimersByTime(10000);
        expect(logger.progress("work", { prefix: "job", count: 200, total: 200 })).toBe(true);
        // Exact completion clears baseline — start a fresh overrun scenario.
        expect(logger.progress("work", { prefix: "fetch", count: 100, total: 150 })).toBe(true);
        vi.advanceTimersByTime(10000);
        expect(logger.progress("work", { prefix: "fetch", count: 160, total: 150 })).toBe(true);
        const overrun = consoleInfo.mock.calls.at(-1)[0];
        expect(overrun).toContain("160/160");
        expect(overrun).toMatch(/\b0(\.0+)?\b/); // remaining clamped
        expect(overrun).toMatch(/\b6(\.0+)?\/s\b/); // 60 items / 10s

        vi.advanceTimersByTime(10000);
        expect(logger.progress("work", { prefix: "fetch", count: 180, total: 150 })).toBe(true);
        const stillTracking = consoleInfo.mock.calls.at(-1)[0];
        // Baseline kept across overrun (80 items / 20s → 4/s), not reset to -/s
        expect(stillTracking).toMatch(/\b4(\.0+)?\/s\b/);
        expect(stillTracking).not.toContain("-/s");
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
        const raw = consoleInfo.mock.calls[0][0];
        const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
        expect(payload).toMatchObject({ level: "info", message: "json-switch" });
    });

    it("formatLog colors a stored struct without a second timestamp when asked", () => {
        const line = formatLog(
            { level: "warn", message: "[HttpClient] GET failed (timeout)" },
            { timestamp: false, showLevel: true, color: false, now: "2026-08-25T15:58:28.000Z" },
        );
        expect(line).toMatch(/^WARN\s+\[HttpClient\] GET failed \(timeout\)$/);
        const withTs = formatLog(
            { level: "info", message: "hello" },
            { timestamp: true, showLevel: true, color: false, now: "2026-08-25T15:58:28.000Z" },
        );
        expect(withTs.startsWith("2026-08-25T15:58:28.000Z INFO")).toBe(true);
    });

    it("formatLog prints process name and task separately from progress prefix", () => {
        const line = formatLog(
            { level: "info", name: "v2intake", task: "retroBackfill:bright", message: "harvesting" },
            { timestamp: false, showLevel: true, color: false },
        );
        expect(line).toMatch(/^INFO\s+\[v2intake\] \[retroBackfill:bright\] harvesting$/);
        const progress = formatLog(
            {
                level: "progress",
                name: "v2intake",
                task: "loadHarvested:bright/media",
                prefix: "bright/media",
                count: 10,
                total: 20,
                message: "loading",
            },
            { timestamp: false, showLevel: true, color: false },
        );
        expect(progress).toContain("[v2intake]");
        expect(progress).toContain("[loadHarvested:bright/media]");
        expect(progress).toContain("bright/media");
    });

    it("child() tags lines without mutating the parent logger", () => {
        const logger = new Logger(createTestContext(), { name: "v2intake", route: "console", showLevel: false });
        const child = logger.child("retroBackfill:bright");
        child.info("window done");
        logger.info("idle");
        const [childLine, parentLine] = consoleInfo.mock.calls.map((c) => c[0]);
        expect(childLine).toContain("[v2intake]");
        expect(childLine).toContain("[retroBackfill:bright]");
        expect(parentLine).toContain("[v2intake]");
        expect(parentLine).not.toContain("retroBackfill");
    });
});


