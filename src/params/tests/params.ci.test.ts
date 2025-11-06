import { describe, it, expect } from "vitest";
import { Params, init, getParamsInstance, joiEdateType, joiStringArrayType } from "../index.js";
import { ParamError } from "../../errors.js";
import Joi from "joi";

describe("Params CI", () => {
    const argsStub = {
        get: (key: string) => {
            const map: Record<string, any> = {
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

        let intercepted: any;
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

    it("covers custom Joi helpers", () => {
        // joiEdateType now returns ISO8601 string
        const now = new Date();
        const nowISO = joiEdateType(now, {} as any);
        expect(typeof nowISO).toBe("string");
        expect(nowISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        
        // Test "now" keyword
        const nowKeyword = joiEdateType("now", {} as any);
        expect(typeof nowKeyword).toBe("string");
        expect(nowKeyword).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        
        // Test relative time
        const future = joiEdateType("+1h", {} as any);
        expect(typeof future).toBe("string");
        expect(future).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        
        // Test direct ISO string pass-through
        const isoString = "2025-01-01T01:01:01.000Z";
        expect(joiEdateType(isoString, {} as any)).toBe(isoString);
        
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
        const referenced = joiEdateType("@startTime+2h", mockHelpers as any);
        expect(referenced).toBe("2025-01-01T02:00:00.000Z");
        
        // Test error cases
        expect(() => joiEdateType("+xh", {} as any)).toThrow(ParamError);
        expect(() => joiEdateType("invalid-date", {} as any)).toThrow(ParamError);
        expect(() => joiEdateType("@missing+1h", {} as any)).toThrow(ParamError);

        const boolArray = joiStringArrayType("boolean");
        expect(boolArray("true,false", {} as any)).toEqual([true, false]);
        expect(joiStringArrayType("string")(undefined as any, {} as any)).toEqual([]);
        expect(() => boolArray("maybe", {} as any)).toThrow(ParamError);
        expect(() => joiStringArrayType("unknown")("value", {} as any)).toThrow(ParamError);
    });

    it("supports singleton helpers", () => {
        const instance = init({ args: argsStub });
        expect(getParamsInstance()).toBe(instance);
    });
});


