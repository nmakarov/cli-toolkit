import { describe, expect, it } from "vitest";
import {
    claimDueInstantMs,
    compareClaimCandidates,
    isClaimDue,
} from "../claimOrder.js";

function sortRows(rows) {
    return [...rows].sort(compareClaimCandidates).map((r) => r.id);
}

describe("claim order", () => {
    it("treats next_run_at or past_due as due, using the earlier instant", () => {
        expect(isClaimDue({ next_run_at: null, past_due: null })).toBe(false);
        expect(isClaimDue({ next_run_at: "2026-08-28T10:00:00.000Z" })).toBe(true);
        expect(isClaimDue({ past_due: "2026-08-28T10:00:00.000Z" })).toBe(true);
        expect(
            claimDueInstantMs({
                next_run_at: "2026-08-28T12:00:00.000Z",
                past_due: "2026-08-28T11:00:00.000Z",
            })
        ).toBe(Date.parse("2026-08-28T11:00:00.000Z"));
    });

    it("picks the earliest due row before any non-due row, even if the non-due has higher priority", () => {
        const ids = sortRows([
            { id: "hot-oneoff", priority: 0, next_run_at: null, past_due: null },
            {
                id: "older-due",
                priority: 90,
                next_run_at: "2026-08-28T09:00:00.000Z",
            },
            {
                id: "newer-due",
                priority: 1,
                next_run_at: "2026-08-28T10:00:00.000Z",
            },
        ]);
        expect(ids).toEqual(["older-due", "newer-due", "hot-oneoff"]);
    });

    it("when nothing is due, picks the highest priority (lowest number)", () => {
        const ids = sortRows([
            { id: "low", priority: 80, created_at: "2026-08-28T08:00:00.000Z" },
            { id: "high", priority: 10, created_at: "2026-08-28T09:00:00.000Z" },
            { id: "mid", priority: 50, created_at: "2026-08-28T07:00:00.000Z" },
        ]);
        expect(ids).toEqual(["high", "mid", "low"]);
    });

    it("uses past_due as the due clock when next_run_at is empty", () => {
        const ids = sortRows([
            { id: "oneoff", priority: 0 },
            { id: "run-now", priority: 50, past_due: "2026-08-28T08:00:00.000Z" },
        ]);
        expect(ids).toEqual(["run-now", "oneoff"]);
    });

    it("breaks due ties with priority, then never-run / oldest completed_at", () => {
        const sameDue = "2026-08-28T10:00:00.000Z";
        const ids = sortRows([
            {
                id: "done-earlier",
                priority: 10,
                next_run_at: sameDue,
                completed_at: "2026-08-28T09:00:00.000Z",
            },
            {
                id: "never-run",
                priority: 10,
                next_run_at: sameDue,
                completed_at: null,
            },
            {
                id: "better-pri",
                priority: 1,
                next_run_at: sameDue,
                completed_at: "2026-08-28T09:30:00.000Z",
            },
        ]);
        expect(ids).toEqual(["better-pri", "never-run", "done-earlier"]);
    });
});
