/**
 * showScreen chrome (must match screens.js + ScreenContainer):
 *   1 marginTop
 *   1 border top + 1 border bottom
 *   1 title
 *   1 divider
 *   1 blank spacer
 *   1 blank spacer
 *   1 divider
 *   N footer lines (default 1)
 *
 * Ink’s log-update does clearTerminal when outputHeight >= stdout.rows.
 * That wipe is the “everything flickers, title scrolled off” failure mode.
 * Keep one unused row so the frame always fits.
 */

export const SCREEN_MARGIN_TOP = 1;
export const SCREEN_CHROME_WITHOUT_FOOTER = 8;
export const INK_HEIGHT_SLACK = 1;

export function getScreenChromeRows({ footerLines = 1 } = {}) {
    return SCREEN_CHROME_WITHOUT_FOOTER + Math.max(0, Number(footerLines) || 0);
}

/**
 * Rows left for a scroll viewport (log lines, list rows) after chrome +
 * any extra header/status lines the body renders.
 */
export function getScreenBodyRows({
    extraRows = 0,
    footerLines = 1,
    minRows = 4,
    termRows = process.stdout.rows || 24,
} = {}) {
    const rows = Number(termRows) || 24;
    const reserved =
        getScreenChromeRows({ footerLines }) +
        Math.max(0, Number(extraRows) || 0) +
        INK_HEIGHT_SLACK;
    return Math.max(minRows, rows - reserved);
}

/**
 * ScreenContainer Box height (margin is outside). margin + this <= termRows - slack.
 */
export function getScreenFrameBoxHeight({ termRows = process.stdout.rows || 24 } = {}) {
    const rows = Number(termRows) || 24;
    return Math.max(8, rows - SCREEN_MARGIN_TOP - INK_HEIGHT_SLACK);
}
