# Tasks Runner

`@nmakarov/cli-toolkit/tasks` provides a DB-backed task queue and polling runner.

Core model:

- Queue table: `<queue>` (default `tasks`)
- History table: `<queue>_history` (default `tasks_history`)
- Producer scripts enqueue tasks
- Runner polls queue, evaluates schedule + conditions, executes handlers, writes history

## Why this model

- Easy to enqueue from any process that can write DB rows
- Reliable state in SQL (pending/running/completed)
- Works well with PM2 later (runner process can be supervised)
- Supports:
  - one-time tasks (`schedule = null`) -> deleted after execution, copied to history
  - recurring tasks (`schedule != null`) -> retained in queue and reset after each run
  - `past_due` prioritization when schedule matched but task couldn't run due to conditions

## Task schema

Queue table columns:

- `id uuid primary key`
- `created_at`, `started_at`, `completed_at`
- `priority int default 0`
- `schedule text` (6-field schedule: `sec min hour day month weekday`)
- `past_due timestamp null`
- `target text` (runner identity)
- `task text` (handler name)
- `params json`
- `opid text null` (operation-chain identifier)
- `progress text`
- `success boolean`
- `results json`

History table has same columns and stores execution records.

## Indices

Queue table indices created by default:

- `(target, started_at, created_at)`
- `(target, past_due, priority, created_at)`
- `(target, task)`

History table indices:

- `(target, created_at)`
- `(task, created_at)`

These are useful for:

- fast polling of pending tasks by runner/target
- prioritizing `past_due` first
- history filtering by target or task

## Runner behavior (`runTasksLoop`)

Each polling tick:

1. Select pending (`started_at IS NULL`) tasks for `target`
2. Prioritize `past_due` before normal tasks
3. For normal scheduled tasks, run only if `timeMatcher(schedule)` is true
4. Instantiate task class and call `cantRunReason()`:
   - if reason returned and not already `past_due`, set `past_due = now()` and skip
5. Claim task atomically (`started_at = now()` where `started_at IS NULL`)
6. Execute handler
7. Write record to history
8. Finalize queue row:
   - one-time task: delete queue row
   - recurring task: reset `started_at`, clear `past_due`, keep row for next schedule

Stop behavior:

- `SIGINT` sets framework stop flag
- a special task named `stop` also requests loop shutdown
- loop waits for currently running tasks to finish

Task scheduling filters:

- `paused_at` (queue table only): paused rows are ignored by the runner
- `--allowedTasks="taskA,taskB"`: runner processes only listed tasks (plus stop tasks)

## API

From `@nmakarov/cli-toolkit/tasks`:

- `ensureTaskTables(context, { queue, recreate })`
- `enqueueTask(context, { queue, target, task, params, opid, priority, schedule })`
- `enqueueStopTask(context, target, queue?)`
- `runTasksLoop(context, { queue, target, pollMs, maxParallel, scanLimit, registry })`
- `waitForTaskResult(context, taskId, { queue, timeoutMs, pollMs })`
- `TasksManager.init(context, options?)`
- `defaultTasksRegistry` (includes built-in `ping`)

## TasksManager

Preferred runner usage:

```ts
const tasksManager = TasksManager.init(context);
await tasksManager.ensureTaskTables();
await tasksManager.runTasksLoop();
```

`TasksManager.init` resolves params with defaults:

- `--table=tasks`
- `--target=localRunner`
- `--recreateTaskTables=false`
- `--pollMs=1000`
- `--maxParallel=1`
- `--scanLimit=100`

## Task handlers

Registry shape:

```ts
type TasksRegistry = Record<string, new (context, task) => TaskInstance>
```

Task instance contract:

```ts
interface TaskInstance {
  cantRunReason?: () => string | false | null | Promise<string | false | null>;
  run: (reportProgress: (progress: any) => Promise<void>) => Promise<{ success: boolean; results?: any }>;
}
```

`reportProgress` updates the `progress` column in queue row.

## CLI runner executable

A package binary is provided:

```bash
npx cli-runner \
  --dbName='local' \
  --table='tasks' \
  --target='localRunner'
```

Options:

- `--dbName` (default: `local`; resolves `dbConnectionString<CapitalizedDbName>`)
- `--table` (default: `tasks`)
- `--target` (required)
- `--recreateTaskTables` (default: false)
- `--pollMs` (default: 1000)
- `--maxParallel` (default: 1)
- `--scanLimit` (default: 100)
- `--tasksModule` optional path to JS module exporting `tasksRegistry`
- `--allowedTasks` optional comma-separated task list for this runner instance
- `--role` runner task preset (`all|harvest|load|photos|ingest`) if `--allowedTasks` not provided
- `--dummyLoadMaxParallel` max concurrent `dummyLoad` tasks (default `2`)
- `--dummyPhotosMaxParallel` max concurrent `dummyPhotos` tasks (default `5`)
- `--tasksLogsEnabled` enable IPC task-log persistence (default `true`)
- `--tasksLogsBasePath`, `--tasksLogsNamespace`, `--tasksLogsTable`, `--tasksLogsMaxVersions`

## Examples

Runner:

```bash
npx tsx examples/tasks/runner.ts \
  --dbName='local' \
  --target='localRunner'
```

Runner role examples:

```bash
# Harvest-only worker
npx tsx examples/tasks/runner.ts --role=harvest

# Load-only worker
npx tsx examples/tasks/runner.ts --role=load

# Photos-only worker
npx tsx examples/tasks/runner.ts --role=photos
```

Recommended prototype defaults:

- `examples/tasks/runner.ts` uses `--maxParallel=8` and `--pollMs=500` by default
- this allows simultaneous harvests across sources while task-level `cantRunReason` still enforces:
  - max 1 harvest per source
  - max 2 loaders (configurable)
  - max 5 photos tasks (configurable)

Ping task producer:

```bash
npx tsx examples/tasks/test-task-ping.ts \
  --dbName='local' \
  --target='localRunner'
```

Generic task producer:

```bash
npx tsx examples/tasks/task.ts \
  --dbName='local' \
  --target='localRunner' \
  create \
  --task='taskSumAB' \
  --params='{a: 2, b: 3}'
```

Ensure recurring dummy harvest tasks:

```bash
npx tsx examples/tasks/ensure-dummy-harvest.ts --schedule="*/10" --pause=false
```

Pause manager screen:

```bash
npx tsx examples/tasks/pause-tasks.ts --table='tasks'
```

Inspect IPC task logs:

```bash
# Latest workflow by source/resource (find latest harvest opid automatically)
npx tsx examples/tasks/task-logs.ts --mode=latestHarvest --source=armls --resource=properties

# Explicit workflow by opid
npx tsx examples/tasks/task-logs.ts --mode=workflow --opid='op_abc123'
```

End-to-end workflow seed + wait:

```bash
npx tsx examples/tasks/workflow-prototype.ts --source=armls --resource=properties --wait=true
```

Delete task examples:

```bash
# Delete by id
npx tsx examples/tasks/task.ts --dbName='local' delete --id='<task-id>'

# Delete by task name
npx tsx examples/tasks/task.ts --dbName='local' delete --task='taskSumAB'

# Interactive picker (press d to delete selected)
npx tsx examples/tasks/task.ts --dbName='local' delete
```

Trace operation chain by `opid`:

```bash
npx tsx examples/tasks/opid-trace.ts --dbName='local' --table='tasks' --opid='op_abc123'
```

Core task `taskSumAB`:

- Input params: `{ a: number, b: number }`
- Success result: `{ a, b, sum }`
- Validation failure: `{ error: "...", received: { a, b } }` with `success=false`

`task.ts` supports command form:

- `create|delete|pause|resume` as first positional command (`create` default)
- `--wait=true` to wait for completion (for `create`)
- `--waitMs=<ms>` completion timeout

Run both in separate terminals; ping task should complete and appear in `<queue>_history`.
