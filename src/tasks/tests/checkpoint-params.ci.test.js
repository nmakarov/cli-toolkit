import { describe, expect, it } from "vitest";
import {
    checkpointParamsFromResults,
    scheduledStopResumesImmediately,
    successStopResumesImmediately,
} from "../index.js";

describe("checkpointParamsFromResults", () => {
    it("returns the object tasks persist so the next claim resumes", () => {
        expect(
            checkpointParamsFromResults({
                checkpointParams: { source: "bright", checkpoint: { pending: { action: "load", offset: 12 } } },
            }),
        ).toEqual({ source: "bright", checkpoint: { pending: { action: "load", offset: 12 } } });
    });

    it("resumes a scheduled hard stop immediately only when a cursor was saved", () => {
        const cursor = { source: "demo", checkpoint: { pending: "alpha" } };
        expect(scheduledStopResumesImmediately({
            stopped: true,
            checkpointParams: cursor,
        })).toBe(true);
        expect(scheduledStopResumesImmediately({
            stopped: true,
        })).toBe(false);
        expect(scheduledStopResumesImmediately({
            skipped: true,
            checkpointParams: cursor,
        })).toBe(false);
        expect(scheduledStopResumesImmediately({
            stopped: false,
            checkpointParams: { ...cursor, checkpoint: null },
        })).toBe(false);
    });

    it("keeps a successful one-off that stopped with a cursor", () => {
        const results = {
            stopped: true,
            checkpointParams: { source: "demo", checkpoint: { pending: ["alpha"] } },
        };
        expect(successStopResumesImmediately(true, results)).toBe(true);
        expect(successStopResumesImmediately(false, results)).toBe(false);
        expect(successStopResumesImmediately(true, { stopped: true })).toBe(false);
        expect(successStopResumesImmediately(true, { skipped: true, checkpointParams: results.checkpointParams })).toBe(false);
    });

    it("ignores missing or non-object payloads", () => {
        expect(checkpointParamsFromResults(null)).toBeNull();
        expect(checkpointParamsFromResults({ stopped: true })).toBeNull();
        expect(checkpointParamsFromResults({ checkpointParams: "nope" })).toBeNull();
        expect(checkpointParamsFromResults({ checkpointParams: [] })).toBeNull();
    });
});
