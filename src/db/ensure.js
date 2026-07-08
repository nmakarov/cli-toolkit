/**
 * Declarative, idempotent DDL — "make sure this schema exists" helpers.
 *
 * Components describe the schema they need (tables, columns, indexes,
 * extensions) once, as data; `ensureSchema` diffs that spec against a live
 * database and applies only what's missing:
 *
 *   - table missing            → CREATE TABLE with all columns + indexes
 *   - table there, column not  → ALTER TABLE ADD COLUMN (never drops/changes)
 *   - index/unique missing     → CREATE [UNIQUE] INDEX IF NOT EXISTS
 *   - extension missing        → CREATE EXTENSION IF NOT EXISTS
 *
 * Because the input is a spec (not imperative code), the same call can be
 * repeated over any number of databases — the main one and every sibling —
 * and each gets exactly the DDL it lacks. See Db.initSibling /
 * Db.discoverSiblings for getting those handles.
 *
 * Spec shape:
 *
 *   {
 *       extensions: ["uuid-ossp"],
 *       tables: {
 *           my_table: {
 *               columns: {
 *                   id:   (t, db) => t.uuid("id").primary().defaultTo(db.raw("uuid_generate_v4()")),
 *                   name: (t) => t.text("name").notNullable(),
 *               },
 *               indexes: [
 *                   { columns: ["name"], name: "my_table_name_idx" },
 *                   { columns: ["a", "b"], name: "my_table_ab_uniq", unique: true },
 *               ],
 *           },
 *       },
 *   }
 *
 * Every function accepts `{ dryRun: true }` and then only *reports* what it
 * would do (returned in the report, logged when a logger is given) without
 * touching the database.
 */

/** @typedef {{ columns: Record<string, Function>, indexes?: Array<{ columns: string[], name: string, unique?: boolean }> }} TableSpec */
/** @typedef {{ extensions?: string[], tables?: Record<string, TableSpec> }} SchemaSpec */

const dbLabel = (db) => db?.config?.name ?? "db";

/**
 * CREATE EXTENSION IF NOT EXISTS (PostgreSQL). No-op report entry on dryRun.
 *
 * @param {Function} db - a connected Db/knex handle
 * @param {string} name - extension name, e.g. "uuid-ossp"
 * @param {{ dryRun?: boolean, logger?: object }} [options]
 * @returns {Promise<{ action: string }>}
 */
export async function ensureExtension(db, name, options = {}) {
    const action = `CREATE EXTENSION IF NOT EXISTS "${name}"`;
    if (!options.dryRun) {
        await db.raw(action);
    }
    options.logger?.silly?.(`[ensure] ${dbLabel(db)}: ${action}${options.dryRun ? " (dryRun)" : ""}`);
    return { action };
}

/**
 * Create a table when missing; when it exists, add any missing columns and
 * indexes from the spec. Never drops or alters existing columns.
 *
 * @param {Function} db
 * @param {string} tableName
 * @param {TableSpec} spec
 * @param {{ dryRun?: boolean, logger?: object }} [options]
 * @returns {Promise<string[]>} human-readable list of applied (or planned) DDL
 */
export async function ensureTable(db, tableName, spec, options = {}) {
    const { dryRun = false, logger } = options;
    const actions = [];
    const exists = await db.tableExists(tableName);

    if (!exists) {
        actions.push(`CREATE TABLE ${tableName} (${Object.keys(spec.columns).length} columns)`);
        if (!dryRun) {
            await db.schema.createTable(tableName, (t) => {
                for (const define of Object.values(spec.columns)) {
                    define(t, db);
                }
            });
        }
    } else {
        // Column-level ensure: add whatever the spec has that the table lacks.
        const missing = [];
        for (const column of Object.keys(spec.columns)) {
            if (!(await db.schema.hasColumn(tableName, column))) {
                missing.push(column);
            }
        }
        if (missing.length > 0) {
            actions.push(`ALTER TABLE ${tableName} ADD COLUMN ${missing.join(", ")}`);
            if (!dryRun) {
                await db.schema.alterTable(tableName, (t) => {
                    for (const column of missing) {
                        spec.columns[column](t, db);
                    }
                });
            }
        }
    }

    for (const index of spec.indexes ?? []) {
        const indexActions = await ensureIndex(db, tableName, index, options);
        actions.push(...indexActions);
    }

    for (const action of actions) {
        logger?.silly?.(`[ensure] ${dbLabel(db)}: ${action}${dryRun ? " (dryRun)" : ""}`);
    }
    return actions;
}

/**
 * Ensure a (unique) index exists. On PostgreSQL this is a real existence check
 * (`CREATE [UNIQUE] INDEX IF NOT EXISTS`); other dialects fall back to
 * attempt-and-tolerate-"already exists".
 *
 * @param {Function} db
 * @param {string} tableName
 * @param {{ columns: string[], name: string, unique?: boolean }} index
 * @param {{ dryRun?: boolean, logger?: object }} [options]
 * @returns {Promise<string[]>}
 */
export async function ensureIndex(db, tableName, index, options = {}) {
    const { dryRun = false } = options;
    const kind = index.unique ? "UNIQUE INDEX" : "INDEX";
    const cols = index.columns.map((c) => `"${c}"`).join(", ");
    const isPg = String(db?.config?.connectionString ?? "").startsWith("postgresql");

    if (isPg) {
        const sql = `CREATE ${kind} IF NOT EXISTS "${index.name}" ON "${tableName}" (${cols})`;
        const { rows } = await db.raw(`SELECT 1 FROM pg_indexes WHERE indexname = ?`, [index.name]);
        if (rows.length > 0) return [];
        if (!dryRun) await db.raw(sql);
        return [sql];
    }

    // Non-pg fallback: try, and treat "already exists" as success.
    const sql = `CREATE ${kind} ${index.name} ON ${tableName} (${cols})`;
    if (!dryRun) {
        try {
            await db.raw(sql);
        } catch (error) {
            if (!/already exists|duplicate/i.test(error?.message ?? "")) throw error;
            return [];
        }
    }
    return [sql];
}

/**
 * Apply a full schema spec to ONE database. Returns the list of applied
 * (or, with dryRun, planned) DDL statements — empty when everything is
 * already in place.
 *
 * @param {Function} db
 * @param {SchemaSpec} spec
 * @param {{ dryRun?: boolean, logger?: object }} [options]
 * @returns {Promise<{ database: string, actions: string[] }>}
 */
export async function ensureSchema(db, spec, options = {}) {
    const actions = [];
    for (const extension of spec.extensions ?? []) {
        // Extensions are cheap no-ops when present; report only in dryRun.
        const { action } = await ensureExtension(db, extension, options);
        if (options.dryRun) actions.push(action);
    }
    for (const [tableName, tableSpec] of Object.entries(spec.tables ?? {})) {
        actions.push(...(await ensureTable(db, tableName, tableSpec, options)));
    }
    return { database: dbLabel(db), actions };
}

/**
 * Apply a schema spec to MANY databases (e.g. the main DB plus every sibling).
 * Convenience loop over {@link ensureSchema} with a combined report and
 * per-database info logging.
 *
 * @param {Function[]} dbs - connected handles (see Db.initAllSiblings)
 * @param {SchemaSpec} spec
 * @param {{ dryRun?: boolean, logger?: object }} [options]
 * @returns {Promise<Array<{ database: string, actions: string[] }>>}
 */
export async function ensureSchemaEverywhere(dbs, spec, options = {}) {
    const reports = [];
    for (const db of dbs) {
        const report = await ensureSchema(db, spec, options);
        if (report.actions.length > 0) {
            options.logger?.info?.(
                `[ensure] ${report.database}: ${options.dryRun ? "would apply" : "applied"} ${report.actions.length} DDL statement(s)`,
            );
        }
        reports.push(report);
    }
    return reports;
}
