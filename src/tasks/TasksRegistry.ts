import type { TaskClass, TasksRegistryMap } from "./types.js";
import { TaskPing } from "./coreTasks/TaskPing.js";
import { TaskSampleProcess } from "./coreTasks/TaskSampleProcess.js";
import { TaskShellCommand } from "./coreTasks/TaskShellCommand.js";
import { TaskSystemInfo } from "./coreTasks/TaskSystemInfo.js";
import { TaskSumAB } from "./coreTasks/TaskSumAB.js";
import { TaskStopRunner } from "./coreTasks/TaskStopRunner.js";
import { TaskGetLogs } from "./coreTasks/TaskGetLogs.js";

export class TasksRegistry {
    private readonly map: TasksRegistryMap = {};

    constructor(initial?: TasksRegistryMap) {
        if (initial) {
            this.addMany(initial);
        }
    }

    static withCoreTasks(): TasksRegistry {
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
            .add("getLogs", TaskGetLogs);
    }

    add(taskName: string, taskClass: TaskClass): TasksRegistry {
        this.map[taskName] = taskClass;
        return this;
    }

    addMany(entries: TasksRegistryMap): TasksRegistry {
        for (const [name, klass] of Object.entries(entries)) {
            this.add(name, klass);
        }
        return this;
    }

    get(taskName: string): TaskClass | undefined {
        return this.map[taskName];
    }

    listSupportedTasks(): string[] {
        return Object.keys(this.map).sort();
    }

    toObject(): TasksRegistryMap {
        return { ...this.map };
    }
}
