# Tasks Prototype Operator Runbook

This runbook is for operating the workflow prototype in `examples/tasks`.

For terminology (servers vs runners, task names, `params` / `results`, useful vs service tasks, targeting, and load-balancing goals), see **`docs/TASKS_RUNNER.md`** → *Runners, servers, and tasks (conceptual)*.

## Goal

Emulate ingest workflow stages:

1. `dummyHarvest` (fetch simulation)
2. `dummyLoad` (load simulation)
3. `dummyPhotos` (photos processing simulation)

Tasks are chained with shared `opid` and can be distributed across multiple runner processes/servers.

## Recommended Terminal Layout

Use 4 terminals:

- **T1 (harvest runner)**
- **T2 (load runner)**
- **T3 (photos runner)**
- **T4 (operations shell)** for enqueue/inspect/pause/log commands

All commands below run from:

`subprojects/cli-toolkit`

## One-Time Setup

Ensure recurring harvest tasks exist:

```bash
npx tsx examples/tasks/ensure-dummy-harvest.ts --dbName=local --table=tasks --target=localRunner --schedule="*/10" --pause=false
```

Notes:

- `--schedule="*/10"` is shorthand for every 10 seconds.
- `--pause=true` can seed the same tasks but paused.
- Existing tasks in `locked by error` state are preserved as locked (not converted to normal paused).

## Start Runners (distributed roles)

### T1: Harvest-only

```bash
npx tsx examples/tasks/runner.ts --dbName=local --table=tasks --target=localRunner --role=harvest
```

### T2: Load-only

```bash
npx tsx examples/tasks/runner.ts --dbName=local --table=tasks --target=localRunner --role=load --dummyLoadMaxParallel=2
```

### T3: Photos-only

```bash
npx tsx examples/tasks/runner.ts --dbName=local --table=tasks --target=localRunner --role=photos --dummyPhotosMaxParallel=5
```

Optional single-runner mode:

```bash
npx tsx examples/tasks/runner.ts --dbName=local --table=tasks --target=localRunner --role=all
```

## Trigger and Observe Workflows

### Seed a single workflow and wait for chain completion

```bash
npx tsx examples/tasks/workflow-prototype.ts --dbName=local --table=tasks --target=localRunner --source=armls --resource=properties --wait=true
```

Expected chain:

- `dummyHarvest` completes and enqueues `dummyLoad`
- `dummyLoad` completes and (for `properties`) enqueues `dummyPhotos`
- all share same `opid`

### Inspect by operation id

```bash
npx tsx examples/tasks/opid-trace.ts --dbName=local --table=tasks --opid='op_abc123'
```

### Inspect persisted IPC logs

Latest workflow by source/resource:

```bash
npx tsx examples/tasks/task-logs.ts --mode=latestHarvest --source=armls --resource=properties
```

Explicit workflow by `opid`:

```bash
npx tsx examples/tasks/task-logs.ts --mode=workflow --opid='op_abc123'
```

## Pause / Unpause Operations

Open task pause manager:

```bash
npx tsx examples/tasks/pause-tasks.ts --dbName=local --table=tasks --target=localRunner
```

Key bindings:

- `p` toggle selected task pause
- `a` pause all
- `u` unpause all
- `q` quit

Paused tasks have `paused_at` set and are ignored by runner pickup.

## Recover Error-Locked Task

Re-run a specific task row after fixing the root cause:

```bash
npx tsx examples/tasks/recover-task.ts --dbName=local --table=tasks --id='<task-id>'
```

Behavior:

- runs the row using the same task class and params from queue
- on success, clears `locked by error` and keeps recurring schedule active
- on failure, task stays locked with `progress="locked by error"`

## Health Check Checklist

- Runners started with expected roles (`harvest/load/photos`)
- Queue has tasks with expected `target`
- `dummyHarvest` generates/enforces `opid`
- `dummyLoad` respects `dummyLoadMaxParallel`
- `dummyPhotos` respects `dummyPhotosMaxParallel`
- Logs are persisted under `tasks-logs/runner` filestore (unless disabled)

## Important Runtime Params

Runner:

- `--allowedTasks="dummyHarvest,dummyLoad"` explicit allowlist
- `--role=harvest|load|photos|ingest|all`
- `--dummyLoadMaxParallel=2` (default)
- `--dummyPhotosMaxParallel=5` (default)

Task log storage:

- `--tasksLogsEnabled=true|false`
- `--tasksLogsBasePath=./data`
- `--tasksLogsNamespace=tasks-logs`
- `--tasksLogsTable=runner`
- `--tasksLogsMaxVersions=20`

## Troubleshooting

- **No tasks processed**
  - verify `target` matches queued rows
  - verify task is not paused (`paused_at is null`)
  - verify runner role/allowlist includes that task
- **Task stuck as pending**
  - check `cantRunReason` conditions (concurrency limits/source lock)
  - increase runner count for appropriate role
- **No logs in `task-logs.ts`**
  - ensure runner started with `tasksLogsEnabled=true`
  - ensure task worker scripts are used (not direct inline execution)
- **Unexpected stop behavior**
  - check if `stop/stopRunner` was enqueued
  - verify stop allowance and active task shutdown logs
