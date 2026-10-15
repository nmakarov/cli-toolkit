import { describe, expect, it } from "vitest";
import { TASK_STATUS_WAITING, waitingHoldPatch } from "../taskUtils.js";

describe("waitingHoldPatch", () => {
    it("marks an idle row waiting and stores the reason", () => {
        expect(waitingHoldPatch({ status: "idle", progress: null, past_due: null }, "bright: lease held")).toEqual({
            status: TASK_STATUS_WAITING,
            progress: "bright: lease held",
            past_due: true,
        });
    });

    it("updates the message when the reason changes", () => {
        expect(
            waitingHoldPatch(
                { status: "waiting", progress: "old", past_due: "2026-01-01" },
                "bright: load still running",
            ),
        ).toEqual({ progress: "bright: load still running" });
    });

    it("does nothing when the same wait is already shown", () => {
        expect(
            waitingHoldPatch(
                { status: "waiting", progress: "bright: lease held", past_due: "2026-01-01" },
                "bright: lease held",
            ),
        ).toBeNull();
    });
});
