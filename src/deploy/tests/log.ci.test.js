import { describe, it, expect, vi } from "vitest";
import { deployNotice } from "../log.js";

describe("deployNotice", () => {
    it("uses logger.notice when present", () => {
        const notice = vi.fn();
        deployNotice({ notice, info: vi.fn() }, "Pull latest repository");
        expect(notice).toHaveBeenCalledWith("Pull latest repository");
    });

    it("falls back to info when notice is missing (console)", () => {
        const info = vi.fn();
        deployNotice({ info }, "Install dependencies");
        expect(info).toHaveBeenCalledWith("Install dependencies");
    });
});
