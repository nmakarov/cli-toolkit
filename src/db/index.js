import knex from "knex";
import { ParamError } from "../errors.js";

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
