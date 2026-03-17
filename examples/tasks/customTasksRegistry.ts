import { TasksRegistry } from "../../src/tasks/index.js";
import { TaskDummyHarvest } from "./TaskDummyHarvest.js";
import { TaskDummyLoad } from "./TaskDummyLoad.js";
import { TaskDummyPhotos } from "./TaskDummyPhotos.js";

export function createExampleTasksRegistry(): TasksRegistry {
    return TasksRegistry.withCoreTasks()
        .add("dummyHarvest", TaskDummyHarvest)
        .add("dummyLoad", TaskDummyLoad)
        .add("dummyPhotos", TaskDummyPhotos);
}
