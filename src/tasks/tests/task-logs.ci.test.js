import { describe, it, expect } from "vitest";
import { filterIpcLogRecords } from "../taskLogs.js";

describe("filterIpcLogRecords", () => {
    const records = [
        { ts: "2026-08-24T17:59:00.000Z", payload: "prev" },
        { ts: "2026-08-24T18:00:00.000Z", payload: "start" },
        { ts: "2026-08-24T18:05:00.000Z", payload: "mid" },
        { ts: "2026-08-24T18:10:00.000Z", payload: "end" },
        { ts: "2026-08-24T18:20:00.000Z", payload: "next" },
    ];

    it("applies afterTs exclusively and fromTs/toTs inclusively", () => {
        expect(
            filterIpcLogRecords(records, { afterTs: "2026-08-24T18:00:00.000Z" }).map((r) => r.payload),
        ).toEqual(["mid", "end", "next"]);
        expect(
            filterIpcLogRecords(records, {
                fromTs: "2026-08-24T18:00:00.000Z",
                toTs: "2026-08-24T18:10:00.000Z",
            }).map((r) => r.payload),
        ).toEqual(["start", "mid", "end"]);
    });
});
