import { describe, expect, it } from "vitest";
import { buildBreadcrumb, buildDetailBreadcrumb } from "../utils.js";
import { getScreenWidth } from "../components.js";

describe("screen utils", () => {
    it("buildBreadcrumb and buildDetailBreadcrumb", () => {
        expect(buildBreadcrumb([])).toBe("");
        expect(buildBreadcrumb(["Menu"])).toBe("Menu");
        expect(buildBreadcrumb(["Menu", "Info"])).toBe("←  Info");
        expect(buildBreadcrumb(["Menu", "Words", "nefarious"])).toBe("←  Words  ←  nefarious");
        expect(buildDetailBreadcrumb(["Menu"], "Details")).toBe("←  Details");
        expect(buildDetailBreadcrumb(["Menu"])).toBe("Menu");
        expect(buildDetailBreadcrumb(["Menu", "Words"], "Details")).toBe("←  Words Details");
        expect(buildDetailBreadcrumb(["Menu", "Words"])).toBe("←  Words");
    });

    it("getScreenWidth uses columns with a floor", () => {
        const prev = process.stdout.columns;
        process.stdout.columns = 40;
        expect(getScreenWidth()).toBe(36);
        expect(getScreenWidth(10)).toBe(10);
        process.stdout.columns = prev;
    });
});
