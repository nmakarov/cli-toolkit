/**
 * CI tests for Init component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, setupContext } from "../index.js";
import { ParamError, InitError } from "../../errors.js";
import { Logger } from "../../logger/index.js";

describe("Init CI Tests", () => {
    let originalExitCode;
    let originalOn;

    beforeEach(() => {
        originalExitCode = process.exitCode;
        originalOn = process.on;
        process.exitCode = undefined;
        // Mock process.on to avoid actual signal handlers in tests
        process.on = vi.fn() ;
    });

    afterEach(() => {
        process.exitCode = originalExitCode;
        process.on = originalOn;
    });

    it("should setup context with Args, Params, and Logger", () => {
        const context = setupContext({ silent: true });
        
        expect(context.args).toBeDefined();
        expect(context.params).toBeDefined();
        expect(context.logger).toBeDefined();
        expect(context.emitter).toBeDefined();
        expect(context.cleanupFunctions).toBeDefined();
        expect(context.registerCleanup).toBeDefined();
        expect(typeof context.isStop).toBe("function");
    });

    it("should execute flow function with context", async () => {
        let receivedContext = null;
        
        const flow = async (context) => {
            receivedContext = context;
        };

        await init(flow, { silent: true });

        expect(receivedContext).toBeDefined();
        expect(receivedContext.args).toBeDefined();
        expect(receivedContext.params).toBeDefined();
        expect(receivedContext.logger).toBeDefined();
    });

    it("should pass overrides to Args and Params", async () => {
        let receivedContext = null;
        
        const flow = async (context) => {
            receivedContext = context;
        };

        await init(flow, {
            overrides: {
                testKey: "overrideValue",
            },
            silent: true,
        });

        expect(receivedContext.args.get("testKey")).toBe("overrideValue");
        expect(receivedContext.params.get("testKey", "string")).toBe("overrideValue");
    });

    it("should pass defaults to Args", async () => {
        let receivedContext = null;
        
        const flow = async (context) => {
            receivedContext = context;
        };

        await init(flow, {
            defaults: {
                defaultKey: "defaultValue",
            },
            silent: true,
        });

        expect(receivedContext.args.get("defaultKey")).toBe("defaultValue");
    });

    it("should configure logger from opts", async () => {
        let receivedContext = null;
        
        const flow = async (context) => {
            receivedContext = context;
        };

        await init(flow, {
            mode: "json",
            route: "ipc",
            prefix: "test",
            modules: ["logger"],
            silent: true,
        });

        expect(receivedContext.logger).toBeDefined();
        // Logger should be configured (we can't easily test mode/route without mocking)
    });

    it("should handle ParamError and set exit code 3", async () => {
        const flow = async (_context) => {
            throw new ParamError("Test param error");
        };

        await init(flow, { silent: true });

        expect(process.exitCode).toBe(3);
    });

    it("should handle InitError and set exit code 4", async () => {
        const flow = async (_context) => {
            throw new InitError("Test init error");
        };

        await init(flow, { silent: true });

        expect(process.exitCode).toBe(4);
    });

    it("should handle other errors and set exit code 5", async () => {
        const flow = async (_context) => {
            throw new Error("Test other error");
        };

        await init(flow, { silent: true });

        expect(process.exitCode).toBe(5);
    });

    it("should run cleanup functions in reverse order", async () => {
        const cleanupOrder = [];
        
        const flow = async (context) => {
            context.registerCleanup(() => {
                cleanupOrder.push(1);
            });
            context.registerCleanup(() => {
                cleanupOrder.push(2);
            });
            context.registerCleanup(() => {
                cleanupOrder.push(3);
            });
        };

        await init(flow, { silent: true });

        expect(cleanupOrder).toEqual([3, 2, 1]);
    });

    it("should handle async cleanup functions", async () => {
        let cleanupCalled = false;
        
        const flow = async (context) => {
            context.registerCleanup(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                cleanupCalled = true;
            });
        };

        await init(flow, { silent: true });

        expect(cleanupCalled).toBe(true);
    });

    it("should handle cleanup function errors gracefully", async () => {
        const flow = async (context) => {
            context.registerCleanup(() => {
                throw new Error("Cleanup error");
            });
        };

        // Should not throw
        await expect(init(flow, { silent: true })).resolves.not.toThrow();
    });

    it("should set isStop function", async () => {
        let receivedContext = null;
        
        const flow = async (context) => {
            receivedContext = context;
        };

        await init(flow, { silent: true });

        expect(typeof receivedContext.isStop).toBe("function");
        expect(receivedContext.isStop()).toBe(false);
    });

    it("setupContext with overrides and defaults", () => {
        const context = setupContext({
            overrides: { overrideKey: "overrideVal" },
            defaults: { defaultKey: "defaultVal" },
            silent: true,
        });
        expect(context.args.get("overrideKey")).toBe("overrideVal");
        expect(context.args.get("defaultKey")).toBe("defaultVal");
    });

    it("setupModules logs when modules option is provided", async () => {
        const flow = async (context) => {
            expect(context.logger).toBeDefined();
        };
        const debugSpy = vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
        await init(flow, { modules: ["db", "screen"], silent: true });
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("setupModules"));
        debugSpy.mockRestore();
    });

    it("runs cleanup when flow throws", async () => {
        const cleanupOrder = [];
        const flow = async (context) => {
            context.registerCleanup(() => cleanupOrder.push(1));
            throw new Error("flow error");
        };
        await init(flow, { silent: true });
        expect(cleanupOrder).toEqual([1]);
    });

    it("--stopAfter=init prints params and exits", async () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) );
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const flow = async () => {};
        await init(flow, { overrides: { stopAfter: "init" }, silent: true });
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Figured Parameters"));
        exitSpy.mockRestore();
        logSpy.mockRestore();
    });
});

