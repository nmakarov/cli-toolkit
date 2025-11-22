/**
 * CI tests for Init component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, setupContext } from "../index.js";
import { ParamError, InitError } from "../../errors.js";

describe("Init CI Tests", () => {
    let originalExitCode: number | undefined;
    let originalOn: typeof process.on;

    beforeEach(() => {
        originalExitCode = process.exitCode;
        originalOn = process.on;
        process.exitCode = undefined;
        // Mock process.on to avoid actual signal handlers in tests
        process.on = vi.fn() as any;
    });

    afterEach(() => {
        process.exitCode = originalExitCode;
        process.on = originalOn;
    });

    it("should setup context with Args, Params, and Logger", () => {
        const context = setupContext();
        
        expect(context.args).toBeDefined();
        expect(context.params).toBeDefined();
        expect(context.logger).toBeDefined();
        expect(context.emitter).toBeDefined();
        expect(context.cleanupFunctions).toBeDefined();
        expect(context.registerCleanup).toBeDefined();
        expect(typeof context.isStop).toBe("function");
    });

    it("should execute flow function with context", async () => {
        let receivedContext: any = null;
        
        const flow = async (context: any) => {
            receivedContext = context;
        };

        await init(flow);

        expect(receivedContext).toBeDefined();
        expect(receivedContext.args).toBeDefined();
        expect(receivedContext.params).toBeDefined();
        expect(receivedContext.logger).toBeDefined();
    });

    it("should pass overrides to Args and Params", async () => {
        let receivedContext: any = null;
        
        const flow = async (context: any) => {
            receivedContext = context;
        };

        await init(flow, {
            overrides: {
                testKey: "overrideValue",
            },
        });

        expect(receivedContext.args.get("testKey")).toBe("overrideValue");
        expect(receivedContext.params.get("testKey", "string")).toBe("overrideValue");
    });

    it("should pass defaults to Args", async () => {
        let receivedContext: any = null;
        
        const flow = async (context: any) => {
            receivedContext = context;
        };

        await init(flow, {
            defaults: {
                defaultKey: "defaultValue",
            },
        });

        expect(receivedContext.args.get("defaultKey")).toBe("defaultValue");
    });

    it("should configure logger from opts", async () => {
        let receivedContext: any = null;
        
        const flow = async (context: any) => {
            receivedContext = context;
        };

        await init(flow, {
            logger: {
                mode: "json",
                route: "ipc",
                prefix: "test",
            },
        });

        expect(receivedContext.logger).toBeDefined();
        // Logger should be configured (we can't easily test mode/route without mocking)
    });

    it("should handle ParamError and set exit code 3", async () => {
        const flow = async (context: any) => {
            throw new ParamError("Test param error");
        };

        await init(flow);

        expect(process.exitCode).toBe(3);
    });

    it("should handle InitError and set exit code 4", async () => {
        const flow = async (context: any) => {
            throw new InitError("Test init error");
        };

        await init(flow);

        expect(process.exitCode).toBe(4);
    });

    it("should handle other errors and set exit code 5", async () => {
        const flow = async (context: any) => {
            throw new Error("Test other error");
        };

        await init(flow);

        expect(process.exitCode).toBe(5);
    });

    it("should run cleanup functions in reverse order", async () => {
        const cleanupOrder: number[] = [];
        
        const flow = async (context: any) => {
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

        await init(flow);

        expect(cleanupOrder).toEqual([3, 2, 1]);
    });

    it("should handle async cleanup functions", async () => {
        let cleanupCalled = false;
        
        const flow = async (context: any) => {
            context.registerCleanup(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                cleanupCalled = true;
            });
        };

        await init(flow);

        expect(cleanupCalled).toBe(true);
    });

    it("should handle cleanup function errors gracefully", async () => {
        const flow = async (context: any) => {
            context.registerCleanup(() => {
                throw new Error("Cleanup error");
            });
        };

        // Should not throw
        await expect(init(flow)).resolves.not.toThrow();
    });

    it("should set isStop function", async () => {
        let receivedContext: any = null;
        
        const flow = async (context: any) => {
            receivedContext = context;
        };

        await init(flow);

        expect(typeof receivedContext.isStop).toBe("function");
        expect(receivedContext.isStop()).toBe(false);
    });
});

