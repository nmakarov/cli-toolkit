import { describe, expect, it, vi } from "vitest";
import { ConsoleFallbackLogger } from "../fallback.js";
import { ConsoleTransport, ParentProcessTransport } from "../transports.js";

describe("logger fallback and transports", () => {
    it("ConsoleFallbackLogger proxies to console", () => {
        const log = new ConsoleFallbackLogger();
        const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        log.debug("d", 1);
        log.warn("w");
        log.error("e");
        expect(debug).toHaveBeenCalledWith("d", 1);
        expect(warn).toHaveBeenCalledWith("w");
        expect(error).toHaveBeenCalledWith("e");
        debug.mockRestore();
        warn.mockRestore();
        error.mockRestore();
    });

    it("transports write to console under VITEST", () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        new ConsoleTransport().write("c");
        new ParentProcessTransport().write("p");
        expect(info).toHaveBeenCalledWith("c");
        expect(info).toHaveBeenCalledWith("p");
        info.mockRestore();
    });
});
