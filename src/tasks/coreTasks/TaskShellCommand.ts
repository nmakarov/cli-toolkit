import { spawn } from "node:child_process";
import type { TaskResult } from "../types.js";
import { TaskMaster } from "../TaskMaster.js";

type CommandExecution = {
    exitCode: number | null;
    output: string;
    stderr: string;
    signal: NodeJS.Signals | null;
};

function runShellCommand(command: string, cwd?: string): Promise<CommandExecution> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, {
            shell: true,
            cwd: cwd || process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            output += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });

        child.on("error", (error) => {
            reject(error);
        });

        child.on("close", (exitCode, signal) => {
            resolve({
                exitCode,
                output: output.trim(),
                stderr: stderr.trim(),
                signal,
            });
        });
    });
}

export class TaskShellCommand extends TaskMaster {
    async run(): Promise<TaskResult> {
        const params = this.task?.params as any;
        const commandRaw = typeof params === "string" ? params : params?.command;
        const cwdRaw = typeof params === "string" ? undefined : params?.cwd;
        const command = typeof commandRaw === "string" ? commandRaw.trim() : "";
        const cwd = typeof cwdRaw === "string" && cwdRaw.trim() ? cwdRaw.trim() : undefined;

        if (!command) {
            return {
                success: false,
                results: {
                    error: 'Validation failed: param "command" must be a non-empty string',
                    received: this.task?.params ?? null,
                },
            };
        }

        try {
            const result = await runShellCommand(command, cwd);
            const success = result.exitCode === 0;

            this.context.logger.info?.(
                `[TaskShellCommand] command="${command}" exitCode=${String(result.exitCode)} (${this.task.id})`
            );

            return {
                success,
                results: {
                    command,
                    cwd: cwd ?? process.cwd(),
                    output: result.output,
                    stderr: result.stderr,
                    exitCode: result.exitCode,
                    signal: result.signal,
                },
            };
        } catch (error: any) {
            return {
                success: false,
                results: {
                    command,
                    cwd: cwd ?? process.cwd(),
                    output: "",
                    stderr: "",
                    exitCode: null,
                    error: error?.message ?? String(error),
                },
            };
        }
    }
}
