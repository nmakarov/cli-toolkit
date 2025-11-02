import { describe, it, expect, beforeEach, vi } from "vitest";
import { Params, joiStringArrayType } from "../index.js";
import Joi from "joi";
import { ParamError } from "../../errors.js";

describe("Params", () => {
    const args = {
        get: vi.fn((key: string) => (key === "fromArgs" ? "valueFromArgs" : undefined))
    };

    let params: Params;

    beforeEach(() => {
        vi.clearAllMocks();
        params = new Params({ args });
    });

    it("validates enumerated values", () => {
        params.set("choice", "invalid", { type: "string", values: ["a", "b"] });
        expect(() => params.get("choice")).toThrow(/should be one of/);
    });

    it("parses CSV arrays", () => {
        params.set("tags", "a,b,c", "array(string)");
        expect(params.get("tags")).toEqual(["a", "b", "c"]);
    });

    it("supports custom Joi transformers", () => {
        const schema = Joi.custom(joiStringArrayType("number"));
        const { value } = schema.validate("1,2,3");
        expect(value).toEqual([1, 2, 3]);
    });

    it("uses registered getters when available", () => {
        params.registerParamGetter((key) => (key === "dynamic" ? "fromGetter" : undefined));
        expect(params.get("dynamic", "string")).toBe("fromGetter");
    });

    it("throws ParamError for invalid boolean array", () => {
        expect(() => {
            params.set("flags", "yes,maybe,no", "array(boolean)");
            params.get("flags");
        }).toThrow(ParamError);
    });
});


