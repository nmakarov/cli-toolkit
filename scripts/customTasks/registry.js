import { TasksRegistry } from "../../src/tasks/TasksRegistry.js";
import { TaskDummyHarvest } from "./TaskDummyHarvest.js";
import { TaskDummyLoad } from "./TaskDummyLoad.js";
import { TaskDummyPhotos } from "./TaskDummyPhotos.js";

/** Core toolkit tasks plus dummy pipeline (`dummyHarvest` → `dummyLoad` → optional `dummyPhotos`). */
export function createExampleTasksRegistry() {
    return TasksRegistry.withCoreTasks()
        .add("dummyHarvest", TaskDummyHarvest)
        .add("dummyLoad", TaskDummyLoad)
        .add("dummyPhotos", TaskDummyPhotos);
}
