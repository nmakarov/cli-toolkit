import os from "node:os";
import fs from "node:fs/promises";
import { AbstractTask } from "../AbstractTask.js";

/**
 * Format bytes as a human-readable gigabyte string, e.g. `"3.25 GB"`.
 *
 * @param {number} valueBytes
 * @returns {string}
 */
function toGb(valueBytes) {
    return `${(valueBytes / (1024 ** 3)).toFixed(2)} GB`;
}

/**
 * Format bytes as a human-readable megabyte string, e.g. `"128.00 MB"`.
 *
 * @param {number} valueBytes
 * @returns {string}
 */
function toMb(valueBytes) {
    return `${(valueBytes / (1024 ** 2)).toFixed(2)} MB`;
}

/**
 * Disk usage for `/` as `{ total, used, free }` strings. Uses `fs.statfs`
 * (Node 20+); for host-level signal we probe the root mount rather than the cwd.
 *
 * @returns {Promise<{ total: string, used: string, free: string }>}
 */
async function getDiskStats() {
    // Node 20+ statfs; use root path for host-level signal.
    const stats = await fs.statfs("/");
    const total = Number(stats.bsize) * Number(stats.blocks);
    const free = Number(stats.bsize) * Number(stats.bavail);
    const used = total - free;
    return {
        total: toGb(total),
        used: toGb(used),
        free: toGb(free),
    };
}

/**
 * Snapshot of host + process stats (memory, CPU utilization, disk, runtime info).
 * Useful for ops dashboards and cluster-wide "ping with telemetry".
 */
export class TaskSystemInfo extends AbstractTask {
    /** Same UX expectation as `ping` — short probe, print the result. */
    static defaultWaitForResult = true;

    /** systemInfo takes no params. */
    static async resolveCustomParams() {
        return null;
    }

    /**
     * @returns {Promise<{ success: boolean, results: unknown }>}
     */
    async run() {
        try {
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            const usedMemory = totalMemory - freeMemory;

            const cpus = os.cpus();
            const cpuUtilization = cpus.map((cpu) => {
                const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
                const usage = ((total - cpu.times.idle) / total) * 100;
                return Number(usage.toFixed(2));
            });

            const processMemory = process.memoryUsage();
            const disk = await getDiskStats();

            const results = {
                memory: {
                    total: toGb(totalMemory),
                    used: toGb(usedMemory),
                    free: toGb(freeMemory),
                },
                processMemory: {
                    rss: toMb(processMemory.rss),
                    heapTotal: toMb(processMemory.heapTotal),
                    heapUsed: toMb(processMemory.heapUsed),
                    external: toMb(processMemory.external),
                },
                disk,
                cpu: {
                    cores: cpuUtilization.length,
                    utilization: cpuUtilization,
                },
                runtime: {
                    platform: os.platform(),
                    arch: os.arch(),
                    uptimeSec: os.uptime(),
                    hostname: os.hostname(),
                },
            };

            this.context.logger.info?.(`[TaskSystemInfo] collected system metrics (${this.task.id})`);
            return { success: true, results };
        } catch (error) {
            return {
                success: false,
                results: {
                    error: "Can't collect system stats",
                    message: error?.message ?? String(error),
                },
            };
        }
    }
}
