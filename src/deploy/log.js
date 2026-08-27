import { appendFile, mkdir } from "node:fs/promises";

/** Section header: what is about to happen. Falls back to info (e.g. `console`). */
export function deployNotice(logger, message) {
    if (typeof logger?.notice === "function") logger.notice(message);
    else logger?.info?.(message);
}

export async function appendDeployLog(deployLogPath, message) {
    await mkdir(deployLogPath.replace(/\/[^/]+$/, ""), { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}\n`;
    await appendFile(deployLogPath, line);
}
