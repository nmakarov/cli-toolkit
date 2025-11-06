/**
 * Operating System Utilities
 * 
 * Helper functions for interacting with the operating system
 * to get system statistics and information
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * Get free disk space for a given path (in bytes)
 * Returns null if unable to determine
 * Uses `df` command on Unix-like systems
 */
export function getFreeDiskSpace(targetPath: string): number | null {
    try {
        // If the target path doesn't exist, use its parent directory
        let pathToCheck = targetPath;
        if (!fs.existsSync(targetPath)) {
            const parentDir = path.dirname(targetPath);
            if (fs.existsSync(parentDir)) {
                pathToCheck = parentDir;
            } else {
                // If parent doesn't exist either, use the root directory
                pathToCheck = process.platform === "win32" ? "C:\\" : "/";
            }
        }

        if (process.platform === "win32") {
            // Windows: use wmic command
            // Note: This is a simplified implementation, may need adjustments
            return null; // TODO: Implement robust Windows support
        } else {
            // Unix-like systems: use df command
            const stdout = execSync(`df -k "${pathToCheck}"`, { encoding: "utf8" });
            const lines = stdout.trim().split("\n");
            const parts = lines[1].split(/\s+/); // second line, split on whitespace
            const freeKb = parseInt(parts[3], 10); // 4th column is "Available"
            return freeKb * 1024; // Convert to bytes
        }
    } catch (error) {
        // Silently fail and return null
        return null;
    }
}

