/**
 * Pause / unpause a task runner service.
 *
 * When paused, the runner finishes in-flight worker tasks and does not claim new
 * worker-lane work until unpaused. Control-lane tasks (stop, pause, unpause,
 * setRuntimeParam, …) still run.
 *
 * Target a service via `--serviceName` (same shape as stopRunner). Persists
 * `metadata.paused` on services_registry for operators / TUI status.
 *
 * Aliases: `pause` / `unpause`.
 */

import { ParamError } from "../../errors.js";
import { AbstractTask } from "../AbstractTask.js";
import { updateServicesRegistryMetadata } from "../servicesRegistry.js";
import { ensureTasksRuntime } from "../runtimeParams.js";

/**
 * @param {object} context
 * @param {boolean} paused
 * @returns {Promise<{ success: true, results: { paused: boolean, message: string } }>}
 */
export async function applyRunnerPaused(context, paused) {
    const runtime = ensureTasksRuntime(context);
    const was = runtime.paused === true;
    runtime.paused = paused === true;

    const registry = context.servicesRegistry;
    if (registry && typeof registry === "object") {
        await updateServicesRegistryMetadata(context, registry, {
            paused: runtime.paused,
            pausedAt: runtime.paused ? new Date().toISOString() : null,
        });
    }

    const message = runtime.paused
        ? was
            ? "Runner already paused (no new worker tasks)."
            : "Runner paused: finishing in-flight work; no new worker tasks until unpause."
        : was
          ? "Runner unpaused: claiming worker tasks again."
          : "Runner already running (not paused).";

    context.logger?.warn?.(
        runtime.paused ? `[TaskPauseRunner] ${message}` : `[TaskUnpauseRunner] ${message}`
    );

    return {
        success: true,
        results: {
            paused: runtime.paused,
            message,
        },
    };
}

/**
 * Pause worker claiming on the targeted service.
 */
export class TaskPauseRunner extends AbstractTask {
    static taskName = "pauseRunner";
    static description =
        "Pause a runner: finish in-flight tasks, claim no new worker tasks until unpaused";
    static aliases = ["pause"];
    static defaultWaitForResult = true;

    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<object>}
     */
    static async resolveParams(context, overrides = {}) {
        const main = await super.resolveParams(context, overrides);
        if (!main.serviceName) {
            throw new ParamError(
                "pause/pauseRunner requires --serviceName (registry instance name; optional --serviceGroup, --instanceNumber, --serverName to narrow targeting)"
            );
        }
        return main;
    }

    async run() {
        return applyRunnerPaused(this.context, true);
    }
}

/**
 * Resume worker claiming on the targeted service.
 */
export class TaskUnpauseRunner extends AbstractTask {
    static taskName = "unpauseRunner";
    static description = "Unpause a runner: resume claiming worker tasks";
    static aliases = ["unpause"];
    static defaultWaitForResult = true;

    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<object>}
     */
    static async resolveParams(context, overrides = {}) {
        const main = await super.resolveParams(context, overrides);
        if (!main.serviceName) {
            throw new ParamError(
                "unpause/unpauseRunner requires --serviceName (registry instance name; optional --serviceGroup, --instanceNumber, --serverName to narrow targeting)"
            );
        }
        return main;
    }

    async run() {
        return applyRunnerPaused(this.context, false);
    }
}
