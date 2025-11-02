import { describe, it, expect } from "vitest";
import { Args } from "../index.js";

describe("Args", () => {
    it("prefers overrides over CLI values", () => {
        const args = new Args({
            args: ["--level=warn"],
            overrides: { level: "debug" }
        });

        expect(args.get("level")).toBe("debug");
    });

    it("collects commands separately from options", () => {
        const args = new Args({ args: ["build", "--verbose"] });
        expect(args.hasCommand("build")).toBe(true);
        expect(args.getCommands()).toEqual(["build"]);
        expect(args.get("verbose")).toBe(true);
    });
});


