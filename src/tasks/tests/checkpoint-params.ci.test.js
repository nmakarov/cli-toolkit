import { describe, expect, it } from "vitest";
import { checkpointParamsFromResults } from "../index.js";

describe("checkpointParamsFromResults", () => {
    it("returns the object tasks persist so the next claim resumes", () => {
        expect(
            checkpointParamsFromResults({
                checkpointParams: { source: "bright", checkpoint: { pending: { action: "load", offset: 12 } } },
            }),
        ).toEqual({ source: "bright", checkpoint: { pending: { action: "load", offset: 12 } } });
    });

    it("ignores missing or non-object payloads", () => {
        expect(checkpointParamsFromResults(null)).toBeNull();
        expect(checkpointParamsFromResults({ stopped: true })).toBeNull();
        expect(checkpointParamsFromResults({ checkpointParams: "nope" })).toBeNull();
        expect(checkpointParamsFromResults({ checkpointParams: [] })).toBeNull();
    });
});
