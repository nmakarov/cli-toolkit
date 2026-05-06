import { spawn } from "node:child_process";
import { ParamError } from "../../errors.js";
import { AbstractTask } from "../AbstractTask.js";

/**
 * Run a shell string, buffering stdout/stderr until exit. Use for short commands
 * only — everything accumulates in memory; long-running / high-throughput work
 * should spawn its own worker instead (see `taskScriptRunner.js`).
 *
 * @param {string} command
 * @param {string} [cwd]
 * @returns {Promise<{ exitCode: number|null, output: string, stderr: string, signal: NodeJS.Signals|null }>}
 */
function runShellCommand(command, cwd) {
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

/**
 * Task wrapper for {@link runShellCommand}. Accepts either:
 *
 *   - `params: "echo hi"` (string shortcut), or
 *   - `params: { command: string, cwd?: string }`.
 *
 * Success is defined as `exitCode === 0`. Non-zero / spawn errors come back as
 * `{ success: false, results: { ... } }` — never a thrown exception.
 */
export class TaskShellCommand extends AbstractTask {
    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<{ command: string, cwd?: string }>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(context, "task-shell", {
            command: "string",
            cwd: "string",
        }, overrides);
        const command = typeof merged.command === "string" ? merged.command.trim() : "";
        if (!command) {
            throw new ParamError('shellCommand: param "command" must be a non-empty string');
        }
        const cwd = typeof merged.cwd === "string" && merged.cwd.trim() ? merged.cwd.trim() : null;
        return cwd ? { command, cwd } : { command };
    }

    /**
     * @returns {Promise<{ success: boolean, results: unknown }>}
     */
    async run() {
        const params = this.task?.params;
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
        } catch (error) {
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
