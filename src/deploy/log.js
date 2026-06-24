import { appendFile, mkdir } from "node:fs/promises";

export async function appendDeployLog(deployLogPath, message) {
    await mkdir(deployLogPath.replace(/\/[^/]+$/, ""), { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}\n`;
    await appendFile(deployLogPath, line);
}
