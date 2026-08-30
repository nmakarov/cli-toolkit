# Tasks Runner

`@nmakarov/cli-toolkit/tasks` provides a DB-backed task queue and polling runner.

Core model:

- Queue table: `<queue>` (default `tasks`)
- History table: `<queue>_history` (default `tasks_history`)
- Services registry table: `<queue>_services_registry` (optional; created by `ensureTaskTables`)
- Producer scripts enqueue tasks
- Runner polls queue, evaluates schedule + conditions, executes handlers, writes history

## Runners, servers, and tasks (conceptual)

This section describes the **intended** operational model. The current CLI and DB fields map loosely as follows: queue row **`task`** = task name; **`params`** / **`results`** = JSON payloads; **`target`** = which runner may claim the row (see below).

### Servers

- A **server** is a machine (VM or bare metal) that may host **one or many** runner processes.
- A server is identifiable by machine identity — e.g. hostname / parsed **`uname -a`** output — or by an **explicit CLI identifier** when you want a stable label independent of the OS name.

### Runners

- A **runner** is a long-lived process that polls the task queue and executes handlers.
- Runners may run **on the same server** (several processes) and/or **across multiple servers**.
- **Runner name**: often derived from the server plus a suffix (e.g. `v2intake_runner1`), or set explicitly via **CLI** (e.g. `runner1`). This name is part of how the runner presents itself to the system (and relates to queue **`target`** / service registry naming).
- **Task allowlist**: each runner is configured with the set of task **names** it is allowed to process (e.g. CLI **`allowedTasks`** / role presets). Only tasks in that list are considered for execution (plus any always-allowed **service** tasks as documented below).

### Tasks

- A task is identified by **name** (string). Input is carried in the **`params`** object (JSON). Outcomes are written to **`results`** (JSON) when the handler finishes.
- **Useful / domain tasks** — business work such as harvest, load, photos, etc.
- **Service / control tasks** — operational hooks such as **`stop`**, **`restart`**, **`info`**, **`ping`**, etc. These exist to supervise and introspect runners rather than perform domain work.

### Task wrapper vs core function

Each queued task behaves as a unit of async work (“a promise”), but conceptually it is a **wrapper** around a **core function** that could run in **any** context — not only inside the runner loop. For example the same core logic can be invoked from a **standalone script**, tests, or a one-off CLI, without going through the DB queue.

**Wrapper responsibilities** (when running as part of the task system):

1. **In** — Read the task row, validate or derive inputs, and **prepare arguments** for the core function from **`params`** (and related row fields as needed).
2. **Run** — Call the task’s **main function** (the real implementation).
3. **Out** — Take return values or thrown errors from that function and **materialize** them on the row: **`results`**, **`success`**, **`progress`**, error messages, etc.

The **main function** itself should stay **free of queue/loop concerns**: it performs the domain operation given plain inputs and returns a result (or fails). That keeps the same code path usable **inside** the runner and **outside** it when you only want to execute the logic directly.

### Dispatch: who picks up a task?

- **By task name only** — enqueue a row so that **any** runner that (a) polls with a matching claim rule and (b) includes that task name in its allowlist can execute it. Good when you do not care which replica runs the job.
- **By task name + runner** — enqueue so only a **specific** runner (or **target**) is eligible — e.g. restrict via **`target`** so a named runner instance is the only one that will claim the row.

### Fairness when several runners share the same task names

When **multiple** runners can process the **same** useful task, we want **load balancing**: work should be spread so one runner does not starve the others (e.g. draining all pending rows while peers stay idle). Tasks behave as independent units of work (async “promises”); **how** the queue is ordered and claimed may need refinement so assignment stays **fair** in practice. This is an active design area before/while we refactor the workflow.

---

## Why this model

- Easy to enqueue from any process that can write DB rows
- Reliable state in SQL (pending/running/completed)
- Works well with PM2 later (runner process can be supervised)
- Supports:
  - one-time tasks (`schedule = null`) -> deleted after execution, copied to history
  - recurring tasks (`schedule != null`) -> retained in queue and reset after each run
  - claim order: earliest due (`past_due` / `next_run_at`) first; otherwise highest priority

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
- prioritizing earliest due (`past_due` / `next_run_at`) first, then priority
- history filtering by target or task

## Runner behavior (`runTasksLoop`)

Each polling tick:

1. Select idle tasks whose targeting matches and whose `next_run_at` is NULL or `<= now`
2. Claim the earliest due row (`past_due` or `next_run_at`); if none are due, the highest priority (lowest number). Same due instant / non-due ties: priority, then never-run / oldest `completed_at`, then `created_at`
3. For scheduled rows that are not already `past_due`, run only if `timeMatcher(schedule)` is true. `resumeTask` (and tasksmm run-now) stamp `past_due` so an unpaused scheduled row is claimed immediately.
4. Instantiate task class and call `cantRunReason()`:
   - if reason returned and not already `past_due`, set `past_due = now()` and skip
5. Claim task atomically (`status = running` where still `idle`)
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

## Services registry (`services_registry`)

Table: **`<queue>_services_registry`** (e.g. `tasks_services_registry`), created by `ensureTaskTables`.

If you previously used `<queue>_runner_heartbeats`, drop or rename that table and let `ensureTaskTables` create the new one (or migrate rows manually).

Purpose:

- **Catalog of running services**: one row per logical service instance (task-runner process), with identity and optional metadata.
- **Liveness**: `last_seen_at` updated on an interval while `runTasksLoop` runs (maintenance/monitoring can treat stale rows as dead and restart or alert).
- **Registry-only identity**: no local identity files. On startup the runner scans **alive** rows (`last_seen` within `--runnerHeartbeatStaleMs`), picks the **first free `instance_number`**, and uses **`service_name`** = `--runnerServiceName` if set, else `{group}-{hostname}-{instance}`. A **stale** row with the same `service_name` is **updated** (takeover) so restarts on the same host can reclaim that row; tasks/services are expected to persist their own state if needed.
- **Service name**: unique per `(queue, service_name)`; on conflict (e.g. racing peers), allocation retries with the next free instance slot.
- **Group caps**: optional max **alive** peers per `service_group` (peers stale after `--runnerHeartbeatStaleMs`). Built-in defaults include `intake: 1`, `harvest: 1`, unlimited `loader` / `photos` / `ingest`. Override with `--runnerGroupMaxInstances` (0 = unlimited). Use `--runnerEnforceMaxInstances=false` to warn instead of exiting when over limit.
- **Role / task filters**: store in `metadata` JSON (e.g. `allowedTasks`). When a service changes what it handles without restarting, call `updateServicesRegistryMetadata` to merge into `metadata` and bump `last_seen_at`.

`runTasksLoop` / `TasksManager` options (also available as CLI params on `examples/tasks/runner.ts`):

- `runnerServiceGroup` — set to register in `services_registry` (example: `intake`, `loader`, `harvest`).
- `runnerServiceName`, `runnerInstanceNumber` (optional fixed slot; otherwise first free), `runnerHeartbeatIntervalMs`, `runnerHeartbeatStaleMs`, `runnerGroupMaxInstances`, `runnerEnforceMaxInstances`, `runnerMetadata`.

While registered, `context.servicesRegistry` holds `{ serviceName, serviceGroup, queueName, target, rowId, registryTable, instanceNumber }`. The same object is also exposed as **`context.runnerHeartbeat`** (deprecated alias).

List registered services that look alive (for tooling / monitoring):

- `listServicesRegistry(context, { queue, serviceGroup?, staleMs? })`

## API

From `@nmakarov/cli-toolkit/tasks`:

- `ensureTaskTables(context, { queueName, recreate })` — with `recreate: true`, drops the queue table, `_history`, and `_services_registry`, then recreates any that are missing
- `enqueueTask(context, { queue, target, task, params, opid, priority, schedule })`
- `enqueueStopTask(context, target, queue?)`
- `runTasksLoop(context, { queue, target, pollMs, maxParallel, scanLimit, registry, runnerServiceGroup?, ... })`
- `queueToTableNames(queue)` → `{ tasksTable, historyTable, registryTable }` (e.g. `<queue>_services_registry` for `registryTable`)
- `registerInServicesRegistry`, `touchServicesRegistry`, `unregisterServicesRegistry`, `listServicesRegistry`, `updateServicesRegistryMetadata`
- Deprecated aliases: `registerRunnerHeartbeat`, `touchRunnerHeartbeat`, `unregisterRunnerHeartbeat`, `listAliveRunnerHeartbeats`
- `waitForTaskResult(context, taskId, { queueName, timeoutMs, pollMs, name, opid })` —
  polls until history appears or timeout. Fast one-shots may finish before the first
  poll sees the queue row; history correlates via `opid` (stamped to the queue id when
  unset) or optional `name`/`opid` hints. Does not treat “queue row gone” as failure.
- `TasksManager.init(context, options?)`
- `defaultTasksRegistry` (includes built-in `ping`)

**Task targeting** (columns on the queued row): `service_group`, `service_name`, `instance_number`, `server_name`. **NULL** on a column means “any” for that dimension. Registered runners match each non-null column to their registry identity. Rows with no per-instance fields (`service_name`, `instance_number`, `server_name` all null) can be claimed without registry identity; instance-specific rows require a registered worker.

- **`ping`** — enqueue with no targeting for broadcast, or set `service_group` only, or set all four fields to hit one instance (same values as the registry row).
- **`stop` / `stopRunner`** — must set `--serviceName` (optionally narrow with group/instance/server); `params.allowanceMs` controls graceful stop (default **60000** ms). Process SIGTERM/SIGINT uses `--stopAllowance` (**seconds**, default **60**) from init; both paths drain in-flight work then unregister.
- **`pause` / `pauseRunner`** / **`unpause` / `unpauseRunner`** — must set `--serviceName`. Pause finishes in-flight worker tasks and stops new worker-lane claims; control-lane tasks (stop, pause, unpause, setRuntimeParam, pauseTask, resumeTask, …) still run. Sets `context.tasksRuntime.paused` and mirrors `metadata.paused` / `metadata.pausedAt` on services_registry (TUI status shows **paused**). Unpause clears the flag and resumes claiming.
- **`pauseTask` / `resumeTask`** — pause or resume a **specific queue row** by `params.taskId`. Idle → `status=paused` immediately; running → stamp `progress.pauseRequested` and call `requestPause()` on the in-process instance when this runner owns it. Cooperative tasks return `{ taskPaused: true, checkpointParams }` so the runner keeps the row as `paused` with the resume cursor written onto `params` — survives restart/redeploy. `resumeTask` sets `paused` → `idle` and leaves those params in place. Control-lane.

### Resume from a checkpoint (required for long-running tasks)

Pause, hard stop, and the next scheduled tick must continue the **same** unit of
work — not skip ahead to the next window.

1. Persist a cursor in `results.checkpointParams` (offset, pending version,
   unfinished action). Write it onto the queue row during the run if a crash
   mid-unit would lose the harvest you just finished.
2. On pause return `{ success: true, results: { taskPaused: true, checkpointParams } }`.
   The runner copies `checkpointParams` onto the row.
3. On hard stop of a **scheduled** task, return `checkpointParams` the same way.
   Finalize now writes those params even when the row goes back to `idle`.
4. On the next `run()`, read `params.checkpoint` / offset **first** and finish
   that unit before planning new work. Clear the cursor when the unit completes.

`checkpointParamsFromResults(results)` is the shared extractor. Future tasks
must follow this pattern — see the mlsfarm `task-resume-checkpoint` Cursor rule.
- **`setRuntimeParam` / `setRunnerParam`** — hot-update runner knobs without restart. Applies to `context.tasksRuntime` (loop re-reads `maxParallel`, `pollMs`, `claimJitterMs`, `scanLimit` every tick) and to the logger for `levels` / `silent` / etc. Targeting: `--serviceName=<one instance>` **or** `--serviceGroup=<group>` (broadcasts to every alive registry row). Examples:
  - `--paramKey=maxParallel --paramValue=16`
  - `--paramKey=levels --paramValue='+debug'`
  - `--paramsJson='{"patch":{"maxParallel":16,"pollMs":500}}'`
  Claimed on the control lane even when workers are saturated. Current knobs are mirrored into services-registry `metadata.runtime`. Declared editable knobs live in `metadata.runtimeParams` (defaults: maxParallel / pollMs / claimJitterMs / scanLimit). Pass `runnerRuntimeParams` to `runTasksLoop` to add/override specs. tasksmm registry → **Change param(s)** edits those and submits one patch.

CLI: `npx cli-send-task` (published bin) or `npm run tasks:send` in this repo → `scripts/send-task.js` (`--name`, optional `--paramsJson`, optional targeting flags, `--allowanceMs` for stop).

### Deploy + graceful restart

`cli-deploy deploy` (default **rolling**): build + flip `current` while the old process keeps running, then `pm2 delete` + `pm2 start` (SIGINT → drain within `kill_timeout` → process **exits 0** → fresh start from ecosystem so `script` / `node_args` / env always apply). Deploy waits until the **new pid** is online and the old pid is gone (not merely `status=online`). Use `--stopFirst` to `pm2 stop` → wait → activate → delete + `pm2 start` when a runner is wedged. Ecosystem `kill_timeout` is derived from manifest `pm2.stopAllowance` (seconds) / `pm2.killTimeout` (ms). Ecosystem also sets `kill_retry_time` from `pm2.killRetryTime` (default **10s**; pm2's own default is 100ms and floods "failed to kill - retrying" during graceful stops).

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

`reportProgress` updates the `progress` column in the queue row. The runner wraps it
with a per-task coalescer (at most one in-flight UPDATE; latest value wins) so
fire-and-forget progress under high `maxParallel` cannot saturate the Knex pool.
Photo-care also gates DB progress on the logger's `progressThrottleMs` (default 2000).

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
- `--tasksRetentionEnabled` (default `true`) — prune `*_history` and IPC logs together
- `--tasksRetentionDays` (default `7`) — keep this many days (`0` disables time prune)
- `--tasksRetentionIntervalMs` (default `3600000`) — how often the runner checks
- `--tasksRetentionMinFreeRatio` (default `0.1`) — shrink the window if the logs volume is below this free ratio
- `--tasksRetentionMinHours` (default `6`) — floor when disk is low

Hot-update the same keys with `setRuntimeParam` (or tasksmm **Change param(s)**).
Enqueue `pruneTaskRetention` on a runner to run one pass immediately.

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
