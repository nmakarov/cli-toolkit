import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliToolkitLogger } from "../index.js";
import { LoggerOptions } from "../types.js";

describe("Logger CLI", () => {
    const consoleInfo = vi.spyOn(console, "info");
    const consoleWarn = vi.spyOn(console, "warn");

    beforeEach(() => {
        consoleInfo.mockReset();
        consoleWarn.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const makeLogger = (options: LoggerOptions = {}) => new CliToolkitLogger({ route: "console", ...options });

    it("logs all levels by default", () => {
        const logger = makeLogger();
        logger.debug("debug message");
        logger.info("info message");
        logger.notice("notice message");
        logger.warn("warn message");
        logger.error("error message");
        logger.logic("logic message");
        logger.silly("silly message");
        logger.results({ ok: true });
        logger.request("op", { a: 1 });
        logger.response("op", { b: 2 });
        logger.progress("progress message", { count: 1, total: 2 });

        // ensure multiple writes occurred
        expect(consoleInfo.mock.calls.length).toBeGreaterThanOrEqual(10);
    });

    it("applies custom level selection", () => {
        const logger = makeLogger({ levels: ["error", "warn"] });
        logger.debug("debug message");
        logger.warn("warn message");
        logger.error("error message");

        expect(consoleInfo).toHaveBeenCalledTimes(2);
        const logs = consoleInfo.mock.calls.map(call => call[0]);
        expect(logs.some(msg => msg.includes("WARN"))).toBe(true);
        expect(logs.some(msg => msg.includes("ERROR"))).toBe(true);
    });

    it("renders JSON when requested", () => {
        const logger = makeLogger({ mode: "json" });
        logger.info("json message", { foo: "bar" });

        expect(consoleInfo).toHaveBeenCalledTimes(1);
        const payload = consoleInfo.mock.calls[0][0];
        expect(payload.level).toBe("info");
        expect(payload.chunks[0]).toEqual({ foo: "bar" });
    });

    it("warns about unknown levels", () => {
        makeLogger({ levels: ["info", "unknown", "-missing"] });
        expect(consoleWarn).toHaveBeenCalled();
        expect(consoleWarn.mock.calls[0][0]).toMatch(/Unknown level/);
    });

    it("throttles progress messages based on prefix", () => {
        vi.useFakeTimers();
        const logger = makeLogger({ progress: { throttleMs: 1000, withTimes: false } });

        for (let i = 1; i <= 5; i++) {
            logger.progress("work", { prefix: "job", count: i, total: 5 });
            vi.advanceTimersByTime(200);
        }

        // first and final calls should always log, may log more depending on timing
        expect(consoleInfo.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("respects silent option", () => {
        const logger = makeLogger({ silent: true });
        logger.info("should not log");
        expect(consoleInfo).not.toHaveBeenCalled();
    });
});


