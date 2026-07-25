import { ParamError } from "../errors.js";
import { TaskPing } from "./coreTasks/TaskPing.js";
import { TaskSampleProcess } from "./coreTasks/TaskSampleProcess.js";
import { TaskShellCommand } from "./coreTasks/TaskShellCommand.js";
import { TaskSystemInfo } from "./coreTasks/TaskSystemInfo.js";
import { TaskSumAB } from "./coreTasks/TaskSumAB.js";
import { TaskStopRunner } from "./coreTasks/TaskStopRunner.js";
import { TaskGetLogs } from "./coreTasks/TaskGetLogs.js";
import { TaskSetRuntimeParam } from "./coreTasks/TaskSetRuntimeParam.js";

/**
 * Name → task class map. Runners look up the class by `task.name` when claiming
 * a row. Keep names stable across versions: the DB queue references them as strings.
 *
 * Backward-compat aliases (e.g. `stop` → `TaskStopRunner`, `info` → `TaskSystemInfo`)
 * are seeded by {@link TasksRegistry.withCoreTasks}.
 */
export class TasksRegistry {
    /**
     * @param {Record<string, Function>} [initial] Optional seed entries to copy in.
     */
    constructor(initial) {
        this.map = {};
        if (initial) {
            this.addMany(initial);
        }
    }

    /**
     * Build a registry pre-populated with every core task plus legacy aliases.
     * Prefer this over `new TasksRegistry()` for anything that wants `ping`/`stop`/etc.
     *
     * @returns {TasksRegistry}
     */
    static withCoreTasks() {
        return new TasksRegistry()
            .add("ping", TaskPing)
            .add("sampleProcess", TaskSampleProcess)
            .add("shellCommand", TaskShellCommand)
            .add("systemInfo", TaskSystemInfo)
            .add("info", TaskSystemInfo)
            .add("taskSumAB", TaskSumAB)
            .add("stopRunner", TaskStopRunner)
            // Backward-compat alias
            .add("stop", TaskStopRunner)
            .add("getLogs", TaskGetLogs)
            .add("setRuntimeParam", TaskSetRuntimeParam)
            .add("setRunnerParam", TaskSetRuntimeParam);
    }

    /**
     * Register a single task class under a name. Overwrites any previous entry.
     *
     * @param {string} taskName
     * @param {Function} taskClass Subclass of `AbstractTask`.
     * @returns {this}
     */
    add(taskName, taskClass) {
        this.map[taskName] = taskClass;
        return this;
    }

    /**
     * Bulk-register a name → class map. Later calls override earlier ones.
     *
     * @param {Record<string, Function>} entries
     * @returns {this}
     */
    addMany(entries) {
        for (const [name, klass] of Object.entries(entries)) {
            this.add(name, klass);
        }
        return this;
    }

    /**
     * Look up a task class by name. Returns `undefined` when the name is unknown;
     * the runner treats that as "some other worker may handle this" and skips.
     *
     * @param {string} taskName
     * @returns {Function | undefined}
     */
    get(taskName) {
        return this.map[taskName];
    }

    /**
     * Strict variant of {@link get}: throws {@link ParamError} (with the list
     * of supported names) when `taskName` is unknown. Use from enqueuer code
     * paths where an unknown name is a hard CLI/programmer error.
     *
     * @param {string} taskName
     * @returns {Function}
     */
    requireClass(taskName) {
        const TaskClass = taskName ? this.map[taskName] : undefined;
        if (!TaskClass) {
            const supported = this.listSupportedTasks().join(", ") || "(none)";
            throw new ParamError(
                `Unknown task "${taskName ?? ""}". Supported on this registry: ${supported}`
            );
        }
        return TaskClass;
    }

    /**
     * Dispatcher used by `send-task` / programmatic enqueuers: pick `name`
     * from `overrides` or `context.params`, look up the class, and delegate
     * to its static {@link AbstractTask.resolveParams} with `name` seeded into
     * the overrides. The returned object is shaped for {@link enqueueTask}.
     *
     * Validation failures (unknown task, missing required custom params, etc.)
     * surface as {@link ParamError} so the caller aborts cleanly before any
     * row is inserted.
     *
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<object>}
     */
    async resolveTaskParams(context, overrides = {}) {
        const overrideName = typeof overrides.name === "string" ? overrides.name.trim() : overrides.name;
        const fromCli = context.params.get("name", "string");
        const cliName = typeof fromCli === "string" ? fromCli.trim() : fromCli;
        const name = overrideName || cliName;
        if (!name) {
            throw new ParamError("Task --name is required (e.g. ping, stop, dummyHarvest)");
        }
        const TaskClass = this.requireClass(name);
        return TaskClass.resolveParams(context, { ...overrides, name });
    }

    /**
     * Names of every registered task, sorted alphabetically (useful for CLI output
     * and allowlist sanity checks).
     *
     * @returns {string[]}
     */
    listSupportedTasks() {
        return Object.keys(this.map).sort();
    }

    /**
     * Shallow copy of the internal map, for handing to `addMany` on another registry
     * or for serialization.
     *
     * @returns {Record<string, Function>}
     */
    toObject() {
        return { ...this.map };
    }
}
