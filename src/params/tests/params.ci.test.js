import { describe, it, expect } from "vitest";
import { Params, joiEdateType, joiStringArrayType } from "../index.js";
import { ParamError } from "../../errors.js";
import Joi from "joi";

describe("Params CI", () => {
    const argsStub = {
        get: (key) => {
            const map = {
                port: 8080,
                listNumbers: "1,2,3",
                listBooleans: "true,false,0,1",
                date: "+1d",
                duration: "P1DT2H",
                feature: "beta",
                camelCase: "Camel",
                arrayString: "one,two",
                fromArgs: "fromArgsValue"
            };
            return map[key];
        }
    };

    it("validates values across getters, setters, args, opts, and defaults", () => {
        const params = new Params({ args: argsStub }, {
            fromOpts: "optValue",
            stored: "15",
            tier: "basic"
        });

        let intercepted;
        params.registerParamSetter((key, value) => {
            if (key === "intercepted") {
                intercepted = value;
                return true;
            }
            return false;
        });
        params.registerParamGetter((key) => (key === "fromGetter" ? "getterValue" : undefined));

        // Setter intercepts value and prevents storage
        params.set("intercepted", "setterValue", "string");
        expect(intercepted).toBe("setterValue");

        // Stored value is validated through Joi coercion
        params.set("storedNumber", "42", "number");
        expect(params.get("storedNumber", "number")).toBe(42);

        // Getter takes precedence
        expect(params.get("fromGetter", "string")).toBe("getterValue");

        // Args precedence
        expect(params.get("port", "number")).toBe(8080);
        expect(params.get("listNumbers", "array(number)")).toEqual([1, 2, 3]);
        expect(params.get("listBooleans", "array(boolean)")).toEqual([true, false, false, true]);
        expect(params.get("duration", "duration")).toBe("P1DT2H");
        // date now returns ISO8601 string, not Date object
        const dateValue = params.get("date", "date");
        expect(typeof dateValue).toBe("string");
        expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(params.get("arrayString", "array(string)")).toEqual(["one", "two"]);

        // Constructor options precedence
        expect(params.get("fromOpts", "string")).toBe("optValue");
        params.set("structured", { type: "string", value: "structured" });
        expect(params.get("structured", "string")).toBe("structured");

        // Defaults when nothing else available
        expect(params.get("missing", "string default fallback")).toBe("fallback");

        // Enumerated validation
        params.set("tier", "basic", { type: "string", values: ["basic", "pro"] });
        expect(params.get("tier")).toBe("basic");
        params.set("badTier", "invalid", "string");
        expect(() => params.get("badTier", { type: "string", values: ["gold"] })).toThrow(ParamError);
        params.set("badBoolean", "yes,maybe", "array(boolean)");
        expect(() => params.get("badBoolean", "array(boolean)")).toThrow(ParamError);

        expect(() => params.get("requiredOnly", "string required")).toThrow(ParamError);

        // assignDefinition reuse
        const firstDef = params.assignDefinition("camelCase", "string");
        const secondDef = params.assignDefinition("camelCase");
        expect(firstDef).toBe(secondDef);

        const snapshot = params.getAll({
            port: "number",
            storedNumber: "number",
            fromOpts: "string",
            listNumbers: "array(number)"
        });
        expect(snapshot).toEqual({
            port: 8080,
            storedNumber: 42,
            fromOpts: "optValue",
            listNumbers: [1, 2, 3]
        });

        // Validation failure path
        const failingDef = { type: Joi.number() };
        expect(() => params.validate("bad", "abc", failingDef)).toThrow(ParamError);

        // Direct conversion edge cases
        expect(() => params.toJoi("number default nope")).toThrow(ParamError);
        expect(params.toJoi("array(string)").validate("one,two").value).toEqual(["one", "two"]);
    });

    it("falls back to defaults when args return undefined", () => {
        const params = new Params({ args: argsStub });
        expect(params.get("timeout", "number default 1000")).toBe(1000);
    });

    it("reads values from args instance", () => {
        const params = new Params({ args: argsStub });
        expect(params.get("fromArgs", "string")).toBe("fromArgsValue");
    });

    describe("reportResolved (components with their own discovery)", () => {
        it("upgrades 'undefined (default)' entries to the discovered value", () => {
            const params = new Params({ args: argsStub });
            // A component probes for an override — nothing there, tracked as default.
            params.runWithModule("blueprints", () => params.get("baseUrl", "string"));
            expect(params.getFiguredByModule().blueprints.baseUrl).toEqual({
                value: undefined,
                source: "default",
            });

            // …then reports what it actually discovered in its config files.
            params.reportResolved("baseUrl", "https://api.example.com", "blueprint", "blueprints");
            expect(params.getFiguredByModule().blueprints.baseUrl).toEqual({
                value: "https://api.example.com",
                source: "blueprint",
            });
        });

        it("leaves explicit cli/env/options values untouched", () => {
            const params = new Params({ args: argsStub });
            params.runWithModule("blueprints", () => params.get("port", "number")); // from args
            params.reportResolved("port", 9999, "blueprint", "blueprints");
            expect(params.getFiguredByModule().blueprints.port).toEqual({
                value: 8080,
                source: "cli",
            });
        });

        it("appends keys Params never saw, under the given module", () => {
            const params = new Params({ args: argsStub });
            params.reportResolved("handler", "ResoBright", "blueprint", "blueprints");
            expect(params.getFiguredByModule().blueprints.handler).toEqual({
                value: "ResoBright",
                source: "blueprint",
            });
        });

        it("first report wins; defaults module to the current one", () => {
            const params = new Params({ args: argsStub });
            params.runWithModule("blueprints", () => {
                params.reportResolved("feedType", "reso", "blueprint");
                params.reportResolved("feedType", "rets", "blueprint");
            });
            expect(params.getFiguredByModule().blueprints.feedType).toEqual({
                value: "reso",
                source: "blueprint",
            });
        });

        it("does not leak across modules", () => {
            const params = new Params({ args: argsStub });
            params.runWithModule("other", () => params.get("top", "number"));
            params.reportResolved("top", 500, "blueprint", "blueprints");
            expect(params.getFiguredByModule().other.top).toEqual({
                value: undefined,
                source: "default",
            });
            expect(params.getFiguredByModule().blueprints.top).toEqual({
                value: 500,
                source: "blueprint",
            });
        });
    });

    it("covers custom Joi helpers", () => {
        // joiEdateType now returns ISO8601 string
        const now = new Date();
        const nowISO = joiEdateType(now, {} );
        expect(typeof nowISO).toBe("string");
        expect(nowISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        
        // Test "now" keyword
        const nowKeyword = joiEdateType("now", {} );
        expect(typeof nowKeyword).toBe("string");
        expect(nowKeyword).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        
        // Test relative time
        const future = joiEdateType("+1h", {} );
        expect(typeof future).toBe("string");
        expect(future).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        
        // Test direct ISO string pass-through
        const isoString = "2025-01-01T01:01:01.000Z";
        expect(joiEdateType(isoString, {} )).toBe(isoString);
        
        // Test cross-parameter reference
        const mockHelpers = {
            prefs: {
                context: {
                    params: {
                        startTime: "2025-01-01T00:00:00.000Z"
                    }
                }
            }
        };
        const referenced = joiEdateType("@startTime+2h", mockHelpers );
        expect(referenced).toBe("2025-01-01T02:00:00.000Z");
        
        // Test error cases
        expect(() => joiEdateType("+xh", {} )).toThrow(ParamError);
        expect(() => joiEdateType("invalid-date", {} )).toThrow(ParamError);
        expect(() => joiEdateType("@missing+1h", {} )).toThrow(ParamError);

        const boolArray = joiStringArrayType("boolean");
        expect(boolArray("true,false", {} )).toEqual([true, false]);
        expect(joiStringArrayType("string")(undefined , {} )).toEqual([]);
        expect(() => boolArray("maybe", {} )).toThrow(ParamError);
        expect(() => joiStringArrayType("unknown")("value", {} )).toThrow(ParamError);
    });

    it("supports static init method", () => {
        const context = { args: argsStub };
        const instance = Params.init(context);
        expect(instance).toBeInstanceOf(Params);
        expect(instance.get("port", "number")).toBe(8080);
    });

    it("getAllForModule tracks params by module", () => {
        const params = new Params({ args: argsStub });
        const scriptVals = params.getAllForModule("script", { port: "number", fromArgs: "string" });
        expect(scriptVals.port).toBe(8080);
        expect(scriptVals.fromArgs).toBe("fromArgsValue");
        const modVals = params.getAllForModule("my-module", { port: "number" });
        expect(modVals.port).toBe(8080);
        const byModule = params.getFiguredByModule();
        expect(byModule.script).toBeDefined();
        expect(byModule["my-module"]).toBeDefined();
        expect(byModule.script.port).toEqual({ value: 8080, source: expect.any(String) });
    });

    it("runWithModule tracks single get under that module", () => {
        const params = new Params({ args: argsStub });
        params.getAllForModule("script", { port: "number" });
        params.runWithModule("mls-client", () => {
            params.get("fromArgs", "string");
        });
        const byModule = params.getFiguredByModule();
        expect(byModule["mls-client"]?.fromArgs).toBeDefined();
        expect(byModule.script?.port).toBeDefined();
    });

    it("runWithModuleAsync tracks awaited get under that module", async () => {
        const params = new Params({ args: argsStub });
        params.getAllForModule("script", { port: "number" });
        await params.runWithModuleAsync("db", async () => {
            await Promise.resolve();
            params.get("fromArgs", "string");
        });
        const byModule = params.getFiguredByModule();
        expect(byModule.db?.fromArgs).toBeDefined();
        expect(byModule.script?.port).toBeDefined();
        expect(byModule.script?.fromArgs).toBeUndefined();
    });

    it("getFiguredByModule and getTrackedParams", () => {
        const params = new Params({ args: argsStub });
        params.get("port", "number");
        params.getAllForModule("a", { fromArgs: "string" });
        const tracked = params.getTrackedParams();
        expect(tracked.length).toBeGreaterThanOrEqual(2);
        expect(tracked.some((p) => p.module === "script")).toBe(true);
        expect(tracked.some((p) => p.module === "a")).toBe(true);
        const figured = params.getAllFigured();
        expect(figured.port).toBeDefined();
        params.clearTrackedParams();
        expect(params.getTrackedParams()).toHaveLength(0);
    });

});


