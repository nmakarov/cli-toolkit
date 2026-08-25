import { describe, it, expect } from "vitest";
import {
    getScreenBodyRows,
    getScreenChromeRows,
    getScreenFrameBoxHeight,
    INK_HEIGHT_SLACK,
    SCREEN_MARGIN_TOP,
} from "../screen-layout.js";

describe("screen layout height", () => {
    it("counts showScreen chrome (margin, border, title, dividers, spacers, footer)", () => {
        expect(getScreenChromeRows()).toBe(9);
        expect(getScreenChromeRows({ footerLines: 2 })).toBe(10);
    });

    it("leaves slack so chrome + extras + viewport stay under the terminal", () => {
        const termRows = 40;
        const extraRows = 3;
        const viewport = getScreenBodyRows({ extraRows, termRows });
        const total = getScreenChromeRows() + extraRows + viewport;
        expect(total).toBe(termRows - INK_HEIGHT_SLACK);
        expect(viewport).toBe(27);
    });

    it("caps the bordered box so margin + box never fill the terminal", () => {
        const termRows = 40;
        const box = getScreenFrameBoxHeight({ termRows });
        expect(box).toBe(termRows - SCREEN_MARGIN_TOP - INK_HEIGHT_SLACK);
        expect(SCREEN_MARGIN_TOP + box).toBeLessThan(termRows);
    });
});
