import knex from "knex";
import { ParamError } from "../errors.js";

export {
    ensureExtension,
    ensureTable,
    ensureIndex,
    ensureSchema,
    ensureSchemaEverywhere,
} from "./ensure.js";

const KNEX_DEFAULTS = {
    testConnection: true,
    pool: { min: 2, max: 10 },
    acquireConnectionTimeout: 10000,
    ssl: { rejectUnauthorized: false },
};

export class Db {
    static async init(context, options = {}) {
        const buildConfig = async () => {
            const defs = {
                dbName: "string",
                dbProfile: "boolean default false",
            };
            const discovered = context?.params?.getAllForModule?.("db", defs) ?? {};
            const merged = { ...discovered, ...options };

            let { dbName, dbProfile } = merged;
            let dbConnectionString = options.dbConnectionString ?? options.connectionString;
            let connectionParam = dbConnectionString ? "options" : null;

            if (!dbConnectionString) {
                const src = context?.args?.getSource?.("dbConnectionString");
                if (src === "cli" || src === "overrides" || src === "config") {
                    dbConnectionString = await context.params.get("dbConnectionString", "string");
                    connectionParam = "dbConnectionString";
                }
            }

            if (!dbConnectionString && dbName && /^(postgresql|mysql):\/\//.test(dbName)) {
                dbConnectionString = dbName;
                dbName = undefined;
            }

            if (!dbConnectionString && dbName) {
                const paramName = `dbConnectionString${capitalizeFirstLetter(dbName)}`;
                dbConnectionString = await context.params.get(paramName, "string");
                connectionParam = paramName;
                if (!dbConnectionString) {
                    throw new ParamError(
                        `Db: cannot find dbConnectionString for dbName="${dbName}" (looked for param "${paramName}")`
                    );
                }
            }

            if (!dbConnectionString) {
                dbConnectionString = await context.params.get("dbConnectionString", "string");
                if (dbConnectionString) {
                    connectionParam = "dbConnectionString";
                }
            }

            if (!dbConnectionString) {
                if (!dbName) {
                    dbName = "local";
                }
                const paramName = `dbConnectionString${capitalizeFirstLetter(dbName)}`;
                dbConnectionString = await context.params.get(paramName, "string");
                connectionParam = paramName;
                if (!dbConnectionString) {
                    throw new ParamError(
                        `Db: cannot find dbConnectionString for dbName="${dbName}" (looked for param "${paramName}")`
                    );
                }
            }

            const displayName = resolveDbDisplayName(
                dbName,
                connectionParam,
                context?.args?.env,
                merged.name
            );

            return {
                ...KNEX_DEFAULTS,
                connectionString: dbConnectionString,
                name: displayName,
                profile: !!dbProfile,
                logger: context.logger,
            };
        };

        const config = context?.params?.runWithModuleAsync
            ? await context.params.runWithModuleAsync("db", buildConfig)
            : await buildConfig();

        return dbConnect(context, config);
    }

    /**
     * Initialize a SIBLING database handler: a database that lives on the same
     * server with the same credentials/options as an existing ("base") one, and
     * differs only by its database name. Typical use: a per-tenant / per-subject
     * database alongside a main database that keeps the shared tables.
     *
     *   context.db = await Db.init(context);                       // main
     *   const sub  = await Db.initSibling(context, "src_bright");  // sibling
     *
     * LOCATION-AGNOSTIC BY DESIGN — the call gracefully falls back to the main
     * database, so callers can use it for all subject data without knowing what
     * has been migrated where:
     *   - empty `siblingName`            → the main handler (same as Db.init)
     *   - sibling DB does not exist yet  → the main handler (data not migrated;
     *     it still lives in the main database)
     * Callers that must not fall back can check `handler === context.db`.
     *
     * Connection string resolution for an actual sibling, in order:
     *   1. Explicit override — param `dbConnectionStringSib<SiblingName>` (env
     *      `DB_CONNECTION_STRING_SIB_<SIBLING_NAME>`, e.g. `src_bright` →
     *      `DB_CONNECTION_STRING_SIB_SRC_BRIGHT`). Nobody needs this on day
     *      one; it is the escape hatch for when a sibling later moves to its
     *      own server — one env var, no code changes (the `SIB_` namespace
     *      both overrides the connection and declares that the sibling
     *      exists, so it never falls back to main).
     *   2. Derived — take the base connection string and swap the database
     *      name (after confirming the database exists on that server). The
     *      base is `options.baseDb` (a Db handler), then
     *      `options.baseConnectionString`, then `context.db`.
     *
     * Handlers are cached per name on the context (`context.siblingDbs`), so
     * any number of components asking for the same sibling share one pool —
     * including the "falls back to main" answer, which is remembered for the
     * lifetime of the process (a mid-run migration is picked up on restart).
     * Disconnect is registered via `context.registerCleanup`, same as the
     * main handler.
     *
     * @param {object} context - context with params/logger (and usually .db)
     * @param {string} [siblingName] - the sibling's database name (e.g. "src_bright")
     * @param {object} [options] - { baseDb, baseConnectionString, dbProfile }
     * @returns {Promise<Db>} connected handler (same proxy shape as Db.init)
     */
    static async initSibling(context, siblingName, options = {}) {
        // Empty name → the main database, so call sites stay location-agnostic.
        if (!siblingName) {
            return resolveMainHandler(context, options);
        }
        if (!/^[a-zA-Z0-9_]+$/.test(siblingName)) {
            throw new ParamError(
                `Db.initSibling: invalid sibling database name "${siblingName}" (letters, digits and _ only)`
            );
        }

        if (!context.siblingDbs) {
            context.siblingDbs = new Map();
        }
        const cached = context.siblingDbs.get(siblingName);
        if (cached) {
            return cached;
        }

        // 1. explicit override: dbConnectionStringSib<SiblingName> param / env var.
        // Its presence also DECLARES the sibling (it may live on another server),
        // so the existence check below is skipped.
        const overrideParam = `dbConnectionStringSib${camelizeDbName(siblingName)}`;
        let connectionString = await context?.params?.get?.(overrideParam, "string");
        if (connectionString) {
            context.logger?.debug?.(
                `[Db] sibling "${siblingName}": using override param "${overrideParam}"`
            );
        } else {
            // 2. derive from the base connection string
            const baseHandle = options.baseDb ?? context.db;
            const base =
                baseHandle?.config?.connectionString ?? options.baseConnectionString;
            if (!base) {
                throw new ParamError(
                    `Db.initSibling: no base connection to derive "${siblingName}" from — ` +
                        `init the main Db first (context.db = await Db.init(context)), ` +
                        `or pass options.baseDb / options.baseConnectionString, ` +
                        `or set the ${overrideParam} param (env ${toEnvKey(overrideParam)})`
                );
            }

            // Not migrated yet? Fall back to the main database so the caller's
            // code works the same before and after the split.
            const exists = await databaseExistsOnServer(baseHandle, base, siblingName);
            if (!exists) {
                context.logger?.debug?.(
                    `[Db] sibling "${siblingName}" does not exist — falling back to the main database`
                );
                const main = await resolveMainHandler(context, options);
                context.siblingDbs.set(siblingName, main);
                return main;
            }

            connectionString = replaceDatabaseName(base, siblingName);
            context.logger?.debug?.(
                `[Db] sibling "${siblingName}": derived from base (${formatConnectionEndpoint(base) ?? "?"})`
            );
        }

        const config = {
            ...KNEX_DEFAULTS,
            connectionString,
            name: siblingName,
            profile: !!options.dbProfile,
            logger: context.logger,
        };

        const handler = await dbConnect(context, config);
        context.siblingDbs.set(siblingName, handler);
        return handler;
    }

    /**
     * Discover the sibling databases that are "currently in use", by name.
     * Two sources, merged (env wins on duplicates):
     *
     *   1. ENV-DECLARED — every `DB_CONNECTION_STRING_SIB_<NAME>` env var
     *      (the dedicated `SIB_` namespace) whose decoded name matches. This
     *      covers siblings that moved to their own server: the same var that
     *      overrides the connection also *registers* the database, so `.env`
     *      stays the single convenient list.
     *   2. SAME-SERVER SCAN — `SELECT datname FROM pg_database` on the base
     *      server (PostgreSQL only), filtered the same way.
     *
     * The caller says what "matches": `{ prefix: "src_" }` or
     * `{ match: /^src_/ }` — the toolkit does not guess a naming convention.
     *
     * @param {object} context - needs context.db (or options.baseDb) for the server scan
     * @param {{ prefix?: string, match?: RegExp, baseDb?: object, env?: object }} options
     * @returns {Promise<Array<{ name: string, origin: "env"|"server" }>>} sorted by name
     */
    static async discoverSiblings(context, options = {}) {
        const { prefix, match, env = process.env } = options;
        if (!prefix && !match) {
            throw new ParamError(`Db.discoverSiblings: pass { prefix: "..." } or { match: /.../ }`);
        }
        const matches = match instanceof RegExp ? (n) => match.test(n) : (n) => n.startsWith(prefix);

        const found = new Map();

        // 1. env-declared siblings (possibly on other servers) — SIB_ namespace
        for (const key of Object.keys(env)) {
            const m = /^DB_CONNECTION_STRING_SIB_(.+)$/.exec(key);
            if (!m || !env[key]) continue;
            const name = m[1].toLowerCase();
            if (matches(name)) {
                found.set(name, "env");
            }
        }

        // 2. same-server scan (PostgreSQL)
        const base = options.baseDb ?? context?.db;
        if (base) {
            const connectionString = String(base.config?.connectionString ?? "");
            if (connectionString.startsWith("postgresql")) {
                const { rows } = await base.raw(
                    "SELECT datname FROM pg_database WHERE datistemplate = false",
                );
                for (const { datname } of rows) {
                    if (matches(datname) && !found.has(datname)) {
                        found.set(datname, "server");
                    }
                }
            } else {
                context?.logger?.warn?.(
                    "[Db] discoverSiblings: server scan supported for PostgreSQL only; using env-declared siblings",
                );
            }
        }

        return [...found]
            .map(([name, origin]) => ({ name, origin }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Discover + connect: one handler per active sibling (cached, pooled —
     * see initSibling). Pass `includeMain: true` to get `[context.db, ...]`,
     * which is the usual shape for "apply this DDL everywhere" loops:
     *
     *   const dbs = await Db.initAllSiblings(context, { prefix: "src_", includeMain: true });
     *   await ensureSchemaEverywhere(dbs, spec, { logger: context.logger });
     *
     * @param {object} context
     * @param {{ prefix?: string, match?: RegExp, includeMain?: boolean, baseDb?: object, env?: object }} options
     * @returns {Promise<Function[]>} connected handlers
     */
    static async initAllSiblings(context, options = {}) {
        const discovered = await Db.discoverSiblings(context, options);
        const handlers = [];
        for (const { name } of discovered) {
            handlers.push(await Db.initSibling(context, name, options));
        }
        return options.includeMain && context.db ? [context.db, ...handlers] : handlers;
    }

    constructor(config) {
        if (!config || !config.connectionString) {
            throw new ParamError("Db: connectionString is required");
        }

        this.knexInstance = null;
        this.isConnected = false;
        this.queriesLog = [];

        this.config = {
            testConnection: true,
            profile: false,
            pool: { min: 2, max: 10 },
            acquireConnectionTimeout: 10000,
            ssl: { rejectUnauthorized: false },
            logger: console,
            ...config,
        };

        this.logger = this.config.logger;

        const instance = this;
        const callableWrapper = function () {
            throw new Error("This should never be called directly");
        };
        callableWrapper._instance = instance;

        return new Proxy(callableWrapper, {
            apply: (target, _thisArg, argumentsList) => {
                const inst = target._instance;
                if (!inst.knexInstance) {
                    throw new Error("Db: Not connected. Call connect() first.");
                }
                return inst.knexInstance(...argumentsList);
            },
            get: (target, prop) => {
                if (prop === "_instance") {
                    return target._instance;
                }

                const inst = target._instance;

                const ownMethods = [
                    "connect",
                    "disconnect",
                    "testConnection",
                    "tableExists",
                    "getQueryLog",
                    "getKnex",
                    "isConnectedToDb",
                    "getErrorMessage",
                    "detectClient",
                    "attachProfiler",
                ];

                if (prop in inst) {
                    const value = inst[prop];
                    if (typeof value === "function" && ownMethods.includes(prop)) {
                        return value.bind(inst);
                    }
                    if (typeof value !== "function") {
                        return value;
                    }
                }

                if (inst.knexInstance) {
                    const knexProp = inst.knexInstance[prop];
                    if (typeof knexProp === "function") {
                        return knexProp.bind(inst.knexInstance);
                    }
                    return knexProp;
                }

                if (prop in inst) {
                    const method = inst[prop];
                    if (typeof method === "function") {
                        return method.bind(inst);
                    }
                    return method;
                }

                return undefined;
            },
        });
    }

    detectClient(connectionString) {
        if (connectionString.match(/^postgresql/)) {
            return "pg";
        }
        if (connectionString.match(/^mysql/)) {
            return "mysql2";
        }
        return null;
    }

    async connect() {
        if (this.isConnected && this.knexInstance) {
            this.logger.warn?.("[Db] Already connected");
            return;
        }

        const client = this.detectClient(this.config.connectionString);
        if (!client) {
            throw new ParamError(
                "Db: Cannot determine client type from connection string. Expected postgresql:// or mysql://"
            );
        }

        try {
            const connectionConfig = {
                connectionString: this.config.connectionString,
                family: 4,
            };

            this.knexInstance = knex({
                client,
                connection: connectionConfig,
                pool: this.config.pool,
                acquireConnectionTimeout: this.config.acquireConnectionTimeout,
                ...(this.config.ssl && { ssl: this.config.ssl }),
            });

            if (this.config.profile) {
                this.attachProfiler();
            }

            if (this.config.testConnection) {
                await this.testConnection();
            }

            this.isConnected = true;
            this.logger.debug?.(formatDbConnectMessage(this.config.name, this.config.connectionString));
        } catch (error) {
            if (error instanceof ParamError) {
                throw error;
            }
            const errorMsg = this.getErrorMessage(error);
            throw new ParamError(`Db: Connection failed - ${errorMsg}`);
        }
    }

    async disconnect() {
        if (!this.knexInstance) {
            return;
        }

        try {
            await this.knexInstance.destroy();
            this.knexInstance = null;
            this.isConnected = false;
            this.queriesLog = [];
            this.logger.debug?.(formatDbDisconnectMessage(this.config.name, this.config.connectionString));
        } catch (error) {
            const errorMsg = this.getErrorMessage(error);
            this.logger.error?.(`[Db] Error disconnecting: ${errorMsg}`);
            throw error;
        }
    }

    getErrorMessage(error) {
        if (error instanceof AggregateError) {
            const errors = error.errors || [];

            if (errors.length > 0) {
                const firstError = errors[0];
                const firstErrorMsg =
                    firstError instanceof Error ? firstError.message : String(firstError);

                const allSimilar = errors.every((e) => {
                    const msg = e instanceof Error ? e.message : String(e);
                    const codeMatch = msg.match(/^(\w+)\s/);
                    const firstCodeMatch = firstErrorMsg.match(/^(\w+)\s/);
                    return codeMatch && firstCodeMatch && codeMatch[1] === firstCodeMatch[1];
                });

                if (allSimilar && errors.length > 1) {
                    const addresses = errors
                        .map((e) => {
                            const msg = e instanceof Error ? e.message : String(e);
                            const addrMatch = msg.match(/([:\d.]+:\d+)/);
                            return addrMatch ? addrMatch[1] : null;
                        })
                        .filter(Boolean);

                    if (addresses.length > 0) {
                        const codeMatch = firstErrorMsg.match(/^(\w+)\s/);
                        const code = codeMatch ? codeMatch[1] : "Connection error";
                        return `${code} (tried: ${addresses.join(", ")})`;
                    }
                }

                const uniqueMessages = [
                    ...new Set(
                        errors.map((e) => (e instanceof Error ? e.message : String(e)))
                    ),
                ];

                if (uniqueMessages.length === 1) {
                    return uniqueMessages[0];
                }

                return uniqueMessages.join("; ");
            }

            return error.message || "Multiple errors occurred";
        }

        if (error instanceof Error) {
            const code = error.code;
            if (code) {
                return `${code}: ${error.message || String(error)}`;
            }
            return error.message || String(error);
        }

        if (typeof error === "string") {
            return error;
        }

        if (error && typeof error === "object" && "message" in error) {
            const msg = String(error.message);
            const code = error.code;
            if (code) {
                return `${code}: ${msg}`;
            }
            return msg;
        }

        return String(error) || "Unknown error";
    }

    async testConnection() {
        if (!this.knexInstance) {
            throw new Error("Db: Not connected. Call connect() first.");
        }

        try {
            const result = await this.knexInstance.raw("SELECT 2+3 AS result");
            const isOk = result.rows?.[0]?.result === 5 || result[0]?.[0]?.result === 5;
            this.logger.debug?.(`[Db] Connection test: ${isOk ? "OK" : "FAILED"}`);
            return isOk;
        } catch (error) {
            const errorMsg = this.getErrorMessage(error);
            this.logger.error?.(`[Db] Connection test failed: ${errorMsg}`);
            throw new ParamError(`Db: Connection test failed - ${errorMsg}`);
        }
    }

    attachProfiler() {
        if (!this.knexInstance) {
            return;
        }

        this.queriesLog = [];
        this.knexInstance.queriesLog = this.queriesLog;

        this.knexInstance.on("query", (query) => {
            query.__startTime = process.hrtime();
        });

        this.knexInstance.on("query-response", (_response, query) => {
            const [seconds, nanoseconds] = process.hrtime(query.__startTime);
            const executionTimeMs = (seconds * 1000 + nanoseconds / 1e6).toFixed(2);

            const logEntry = {
                sql: query.sql,
                bindings: query.bindings || [],
                executionTimeMs,
            };

            this.queriesLog.push(logEntry);
            this.logger.debug?.(`[Db] Query: ${query.sql} | Duration: ${executionTimeMs}ms`);
        });

        this.knexInstance.on("query-error", (error, query) => {
            this.logger.error?.(`[Db] Query failed: ${query.sql}`, error);
        });
    }

    getQueryLog() {
        return [...this.queriesLog];
    }

    async tableExists(tableName) {
        if (!this.knexInstance) {
            throw new Error("Db: Not connected. Call connect() first.");
        }

        try {
            return await this.knexInstance.schema.hasTable(tableName);
        } catch (error) {
            this.logger.error?.(`[Db] Error checking table existence: ${error.message}`);
            throw error;
        }
    }

    getKnex() {
        if (!this.knexInstance) {
            throw new Error("Db: Not connected. Call connect() first.");
        }
        return this.knexInstance;
    }

    isConnectedToDb() {
        return this.isConnected && this.knexInstance !== null;
    }
}

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * The main database handler, for initSibling's fallbacks: the base handle when
 * one was passed, otherwise `context.db` (initialized on demand, so an
 * initSibling-only script still works).
 */
async function resolveMainHandler(context, options = {}) {
    if (options.baseDb) {
        return options.baseDb;
    }
    if (!context.db) {
        context.db = await Db.init(context);
    }
    return context.db;
}

/**
 * Does `databaseName` exist on the base server? Checked via an existing handle
 * when available (no extra connection), else a short-lived one. Non-PostgreSQL
 * bases skip the check (returns true — connection will tell).
 */
async function databaseExistsOnServer(baseHandle, baseConnectionString, databaseName) {
    if (!String(baseConnectionString).startsWith("postgresql")) {
        return true;
    }
    const query = "SELECT 1 FROM pg_database WHERE datname = ?";
    if (baseHandle) {
        const { rows } = await baseHandle.raw(query, [databaseName]);
        return rows.length > 0;
    }
    const shortLived = knex({
        client: "pg",
        connection: { connectionString: baseConnectionString },
        pool: { min: 0, max: 1 },
    });
    try {
        const { rows } = await shortLived.raw(query, [databaseName]);
        return rows.length > 0;
    } finally {
        await shortLived.destroy();
    }
}

/**
 * Database name → camelCase param suffix: "src_bright" → "SrcBright",
 * so the override param becomes dbConnectionStringSibSrcBright
 * (env DB_CONNECTION_STRING_SIB_SRC_BRIGHT).
 */
function camelizeDbName(name) {
    return name
        .split(/[_-]+/)
        .filter(Boolean)
        .map(capitalizeFirstLetter)
        .join("");
}

/** camelCase param name → its SNAKE_CASE env var (for error messages only). */
function toEnvKey(key) {
    return key.replace(/([A-Z])/g, "_$1").toUpperCase();
}

/**
 * Replace the database name in a connection string, keeping everything else
 * (credentials, host, port, query options like sslmode) intact.
 * Exported for reuse (e.g. database-splitting tools) and tests.
 */
export function replaceDatabaseName(connectionString, databaseName) {
    let url;
    try {
        url = new URL(connectionString);
    } catch {
        throw new ParamError(
            `Db: cannot parse connection string to derive a sibling database from it`
        );
    }
    url.pathname = `/${databaseName}`;
    return url.toString();
}

function resolveDbDisplayName(dbName, connectionParam, argsEnv, mergedName) {
    if (dbName) {
        return dbName;
    }
    if (mergedName) {
        return mergedName;
    }
    if (
        connectionParam?.startsWith("dbConnectionString") &&
        connectionParam.length > "dbConnectionString".length
    ) {
        return connectionParam.slice("dbConnectionString".length).toLowerCase();
    }
    if (connectionParam === "dbConnectionString" && argsEnv) {
        return argsEnv;
    }
    return undefined;
}

function formatDbConnectMessage(name, connectionString) {
    const endpointSuffix = formatConnectionEndpointSuffix(connectionString);
    if (name) {
        return `[Db] Connected to database "${name}"${endpointSuffix}`;
    }
    return `[Db] Connected${endpointSuffix}`;
}

function formatDbDisconnectMessage(name, connectionString) {
    const endpointSuffix = formatConnectionEndpointSuffix(connectionString);
    if (name) {
        return `[Db] Disconnected from database "${name}"${endpointSuffix}`;
    }
    return `[Db] Disconnected${endpointSuffix}`;
}

function formatDbInstanceMessage(action, name) {
    if (name) {
        return `[Db] instance "${name}" ${action}`;
    }
    return `[Db] instance ${action}`;
}

function formatConnectionEndpointSuffix(connectionString) {
    const endpoint = formatConnectionEndpoint(connectionString);
    return endpoint ? ` (${endpoint})` : "";
}

function formatConnectionEndpoint(connectionString) {
    try {
        const url = new URL(connectionString);
        const host = url.hostname;
        if (!host) {
            return null;
        }

        let port = url.port;
        if (!port) {
            if (url.protocol === "postgresql:") {
                port = "5432";
            } else if (url.protocol === "mysql:") {
                port = "3306";
            }
        }

        return port ? `${host}:${port}` : host;
    } catch {
        return null;
    }
}

async function dbConnect(context, config) {
    try {
        const db = new Db(config);

        context.registerCleanup(async () => {
            await db.disconnect();
            context.logger.debug?.(formatDbInstanceMessage("disconnected", config.name));
        });

        await db.connect();

        context.logger.debug?.(formatDbInstanceMessage("initialized", config.name));

        return db;
    } catch (error) {
        if (error instanceof ParamError) {
            throw error;
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new ParamError(`[Db] connect error: ${errorMsg}`);
    }
}
