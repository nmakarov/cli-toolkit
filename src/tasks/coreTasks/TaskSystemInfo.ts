import os from "node:os";
import fs from "node:fs/promises";
import type { TaskResult } from "../types.js";
import { AbstractTask } from "../AbstractTask.js";

function toGb(valueBytes: number): string {
    return `${(valueBytes / (1024 ** 3)).toFixed(2)} GB`;
}

function toMb(valueBytes: number): string {
    return `${(valueBytes / (1024 ** 2)).toFixed(2)} MB`;
}

async function getDiskStats(): Promise<{ total: string; used: string; free: string }> {
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

export class TaskSystemInfo extends AbstractTask {
    async run(): Promise<TaskResult> {
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
        } catch (error: any) {
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
