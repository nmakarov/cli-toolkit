/**
 * Database Client - Low-level SQL database operations
 *
 * Wraps Knex.js with connection management, profiling, and utility functions.
 * The instance can be used directly like a Knex instance: db('table').select()
 */

import knex, { Knex } from 'knex';
import { ParamError } from '../errors.js';
import type { Context } from '../init/types.js';
import type { DbConfig, DbOptions, DatabaseClient, QueryLogEntry, DbInstance } from './types.js';

/**
 * Database client wrapper around Knex
 * 
 * Usage:
 * ```typescript
 * const db = new Db({
 *   connectionString: 'postgresql://user:pass@host:5432/dbname',
 *   testConnection: true,
 *   profile: false
 * });
 * await db.connect();
 * 
 * // Use like Knex:
 * const users = await db('users').select('*');
 * await db('posts').insert({ title: 'Hello' });
 * ```
 */
export class Db {
    private knexInstance: Knex | null = null;
    private config: Required<DbConfig>;
    private logger: any;
    private queriesLog: QueryLogEntry[] = [];
    private isConnected: boolean = false;

    /**
     * Constructor - accepts config object
     * Use dbInit() function to initialize with Context
     */
    constructor(config: DbConfig) {
        if (!config.connectionString) {
            throw new ParamError('Db: connectionString is required');
        }

        this.config = {
            testConnection: true,
            profile: false,
            pool: { min: 2, max: 10 },
            acquireConnectionTimeout: 10000,
            ssl: { rejectUnauthorized: false },
            logger: console,
            name: 'default',
            ...config,
        };

        this.logger = this.config.logger;

        // Create a callable function wrapper that forwards to the instance
        // This allows db('table') to work like Knex
        const instance = this;
        const callableWrapper = function(...args: any[]) {
            // This function body is never executed - the Proxy apply trap handles calls
            // But we need a function to make the Proxy apply trap work
            throw new Error('This should never be called directly');
        };
        
        // Store instance reference on the wrapper for Proxy access
        (callableWrapper as any)._instance = instance;

        // Create a Proxy that makes the wrapper callable and forwards property access
        return new Proxy(callableWrapper, {
            // Intercept function calls: db('table')
            apply: (target, thisArg, argumentsList) => {
                const inst = (target as any)._instance;
                if (!inst.knexInstance) {
                    throw new Error('Db: Not connected. Call connect() first.');
                }
                // Forward the call to the Knex instance (Knex instances are callable)
                return (inst.knexInstance as any)(...argumentsList);
            },
            // Intercept property access: db.schema, db.raw, etc.
            get: (target, prop) => {
                // Allow access to _instance for internal use
                if (prop === '_instance') {
                    return (target as any)._instance;
                }
                
                const instance = (target as any)._instance;
                
                // List of our own methods that should NOT be forwarded to Knex
                const ownMethods = [
                    'connect',
                    'disconnect',
                    'testConnection',
                    'tableExists',
                    'getQueryLog',
                    'getKnex',
                    'isConnectedToDb',
                    'getErrorMessage',
                    'detectClient',
                    'attachProfiler',
                ];
                
                // Always return our own methods first (before checking Knex)
                if (prop in instance) {
                    const value = (instance as any)[prop];
                    // If it's one of our own methods, return it bound to instance
                    if (typeof value === 'function' && ownMethods.includes(prop as string)) {
                        return value.bind(instance);
                    }
                    // If it's a non-function property, return it
                    if (typeof value !== 'function') {
                        return value;
                    }
                }
                
                // If we have a Knex instance, forward to it for everything else
                if (instance.knexInstance) {
                    const knexProp = (instance.knexInstance as any)[prop];
                    if (typeof knexProp === 'function') {
                        // Bind methods to the Knex instance
                        return knexProp.bind(instance.knexInstance);
                    }
                    return knexProp;
                }
                
                // Return our own methods that aren't in the ownMethods list (shouldn't happen, but fallback)
                if (prop in instance) {
                    const method = (instance as any)[prop];
                    if (typeof method === 'function') {
                        return method.bind(instance);
                    }
                    return method;
                }
                
                // Property doesn't exist
                return undefined;
            },
        }) as any;
    }

    /**
     * Detect database client type from connection string
     */
    private detectClient(connectionString: string): DatabaseClient | null {
        if (connectionString.match(/^postgresql/)) {
            return 'pg';
        }
        if (connectionString.match(/^mysql/)) {
            return 'mysql2';
        }
        return null;
    }

    /**
     * Connect to the database
     */
    async connect(): Promise<void> {
        if (this.isConnected && this.knexInstance) {
            this.logger.warn?.('[Db] Already connected');
            return;
        }

        const client = this.detectClient(this.config.connectionString);
        if (!client) {
            throw new ParamError(
                `Db: Cannot determine client type from connection string. Expected postgresql:// or mysql://`
            );
        }

        try {
            // Force IPv4 only (disable IPv6) by setting family: 4 in connection config
            // Knex accepts connection as string or object; we wrap string to add family option
            const connectionConfig = {
                connectionString: this.config.connectionString,
                family: 4, // Force IPv4 only (disable IPv6)
            };

            this.knexInstance = knex({
                client,
                connection: connectionConfig,
                pool: this.config.pool,
                acquireConnectionTimeout: this.config.acquireConnectionTimeout,
                ...(this.config.ssl && { ssl: this.config.ssl }),
            } as any);

            // Attach profiler if enabled
            if (this.config.profile) {
                this.attachProfiler();
            }

            // Test connection if requested
            if (this.config.testConnection) {
                await this.testConnection();
            }

            this.isConnected = true;
            this.logger.debug?.(`[Db] Connected to database "${this.config.name || this.config.connectionString}"`);
        } catch (error: any) {
            // If testConnection already threw a ParamError, preserve its message
            if (error instanceof ParamError) {
                throw error;
            }
            const errorMsg = this.getErrorMessage(error);
            throw new ParamError(`Db: Connection failed - ${errorMsg}`);
        }
    }

    /**
     * Disconnect from the database
     */
    async disconnect(): Promise<void> {
        if (!this.knexInstance) {
            return;
        }

        try {
            await this.knexInstance.destroy();
            this.knexInstance = null;
            this.isConnected = false;
            this.queriesLog = [];
            this.logger.debug?.(`[Db] Disconnected from database "${this.config.name || this.config.connectionString}"`);
        } catch (error: any) {
            const errorMsg = this.getErrorMessage(error);
            this.logger.error?.(`[Db] Error disconnecting: ${errorMsg}`);
            throw error;
        }
    }

    /**
     * Extract error message from various error types
     */
    private getErrorMessage(error: any): string {
        // Handle AggregateError (can contain multiple errors)
        if (error instanceof AggregateError) {
            const errors = error.errors || [];
            
            // If all errors are the same type (e.g., ECONNREFUSED for different IPs), show a consolidated message
            if (errors.length > 0) {
                const firstError = errors[0];
                const firstErrorMsg = firstError instanceof Error ? firstError.message : String(firstError);
                
                // Check if all errors are similar (same error code/type, different addresses)
                const allSimilar = errors.every((e: any) => {
                    const msg = e instanceof Error ? e.message : String(e);
                    // Extract error code (e.g., "ECONNREFUSED") from message
                    const codeMatch = msg.match(/^(\w+)\s/);
                    const firstCodeMatch = firstErrorMsg.match(/^(\w+)\s/);
                    return codeMatch && firstCodeMatch && codeMatch[1] === firstCodeMatch[1];
                });
                
                if (allSimilar && errors.length > 1) {
                    // Extract addresses/IPs from error messages
                    const addresses = errors.map((e: any) => {
                        const msg = e instanceof Error ? e.message : String(e);
                        // Try to extract address (e.g., "::1:5432" or "127.0.0.1:5432")
                        const addrMatch = msg.match(/([:\d.]+:\d+)/);
                        return addrMatch ? addrMatch[1] : null;
                    }).filter(Boolean);
                    
                    if (addresses.length > 0) {
                        // Show consolidated message with all addresses
                        const codeMatch = firstErrorMsg.match(/^(\w+)\s/);
                        const code = codeMatch ? codeMatch[1] : 'Connection error';
                        return `${code} (tried: ${addresses.join(', ')})`;
                    }
                }
                
                // Fallback: show all errors but deduplicate identical messages
                const uniqueMessages = [...new Set(errors.map((e: any) => {
                    return e instanceof Error ? e.message : String(e);
                }))];
                
                if (uniqueMessages.length === 1) {
                    return uniqueMessages[0];
                }
                
                return uniqueMessages.join('; ');
            }
            
            return error.message || 'Multiple errors occurred';
        }
        
        // Handle standard Error objects
        if (error instanceof Error) {
            // Check for common database error properties (code is often present on Node.js errors)
            const errorWithCode = error as Error & { code?: string };
            if (errorWithCode.code) {
                return `${errorWithCode.code}: ${error.message || String(error)}`;
            }
            return error.message || String(error);
        }
        
        // Handle string errors
        if (typeof error === 'string') {
            return error;
        }
        
        // Handle objects with message property
        if (error?.message) {
            const msg = String(error.message);
            const errorWithCode = error as { code?: string };
            if (errorWithCode.code) {
                return `${errorWithCode.code}: ${msg}`;
            }
            return msg;
        }
        
        // Fallback: try to stringify the error
        return String(error) || 'Unknown error';
    }

    /**
     * Test database connection
     */
    async testConnection(): Promise<boolean> {
        if (!this.knexInstance) {
            throw new Error('Db: Not connected. Call connect() first.');
        }

        try {
            const result = await this.knexInstance.raw('SELECT 2+3 AS result');
            const isOk = result.rows?.[0]?.result === 5 || result[0]?.[0]?.result === 5;
            this.logger.debug?.(`[Db] Connection test: ${isOk ? 'OK' : 'FAILED'}`);
            return isOk;
        } catch (error: any) {
            const errorMsg = this.getErrorMessage(error);
            this.logger.error?.(`[Db] Connection test failed: ${errorMsg}`);
            throw new ParamError(`Db: Connection test failed - ${errorMsg}`);
        }
    }

    /**
     * Attach query profiler to log all queries
     */
    attachProfiler(): void {
        if (!this.knexInstance) {
            return;
        }

        this.queriesLog = [];
        (this.knexInstance as any).queriesLog = this.queriesLog;

        this.knexInstance.on('query', (query: any) => {
            query.__startTime = process.hrtime();
        });

        this.knexInstance.on('query-response', (response: any, query: any) => {
            const [seconds, nanoseconds] = process.hrtime(query.__startTime);
            const executionTimeMs = ((seconds * 1000) + (nanoseconds / 1e6)).toFixed(2);

            const logEntry: QueryLogEntry = {
                sql: query.sql,
                bindings: query.bindings || [],
                executionTimeMs,
            };

            this.queriesLog.push(logEntry);
            this.logger.debug?.(`[Db] Query: ${query.sql} | Duration: ${executionTimeMs}ms`);
        });

        this.knexInstance.on('query-error', (error: Error, query: any) => {
            this.logger.error?.(`[Db] Query failed: ${query.sql}`, error);
        });
    }

    /**
     * Get query log (only available if profiling is enabled)
     */
    getQueryLog(): QueryLogEntry[] {
        return [...this.queriesLog];
    }

    /**
     * Check if a table exists
     */
    async tableExists(tableName: string): Promise<boolean> {
        if (!this.knexInstance) {
            throw new Error('Db: Not connected. Call connect() first.');
        }

        try {
            return await this.knexInstance.schema.hasTable(tableName);
        } catch (error: any) {
            this.logger.error?.(`[Db] Error checking table existence: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get the underlying Knex instance (for advanced usage)
     */
    getKnex(): Knex {
        if (!this.knexInstance) {
            throw new Error('Db: Not connected. Call connect() first.');
        }
        return this.knexInstance;
    }

    /**
     * Get connection status
     */
    isConnectedToDb(): boolean {
        return this.isConnected && this.knexInstance !== null;
    }

    /**
     * Initialize Db with context (connects and registers disconnect cleanup).
     * Params are read via getAllForModule("db", defs). Same as dbInit(context, dbNameOrConnectionString).
     */
    static async init(context: Context, dbNameOrConnectionString?: string): Promise<Db> {
        return dbFindAndConnect(context, dbNameOrConnectionString);
    }
}

/**
 * Helper function to capitalize first letter of a string
 */
function capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Connect to database - creates Db instance, connects, registers cleanup, attaches profiler
 * 
 * This is a dedicated connect function that handles:
 * - Creating Db instance with proper configuration
 * - Connecting to database
 * - Registering cleanup function
 * - Attaching profiler if needed
 * - Better error handling
 */
export async function dbConnect(
    context: Context,
    connectionString: string,
    name?: string,
    dbProfile?: boolean
): Promise<Db> {
    // Get configuration from params
    const defs = {
        testDbConnection: 'boolean default true',
        name: 'string',
        poolMin: 'number default 2',
        poolMax: 'number default 10',
        acquireConnectionTimeout: 'number default 10000',
        sslRejectUnauthorized: 'boolean default false',
    };
    
    const paramsConfig = context.params.getAllForModule(defs);

    // Create config
    const config: DbConfig = {
        connectionString,
        name: paramsConfig.name || name || 'default',
        testConnection: paramsConfig.testDbConnection,
        profile: dbProfile ?? false,
        pool: {
            min: paramsConfig.poolMin,
            max: paramsConfig.poolMax,
        },
        acquireConnectionTimeout: paramsConfig.acquireConnectionTimeout,
        ssl: {
            rejectUnauthorized: paramsConfig.sslRejectUnauthorized,
        },
        logger: context.logger,
    };
    
    try {
        // Create Db instance
        const db = new Db(config);
        
        // Register cleanup function
        context.registerCleanup(async () => {
            await db.disconnect();
            context.logger.debug(`[Db] instance "${name || connectionString}" destroyed`);
        });
        
        // Connect to database (profiler is attached automatically if config.profile is true)
        await db.connect();
        
        context.logger.debug(`[Db] instance "${name || connectionString}" initialized`);
        
        return db;
    } catch (error: any) {
        // Better error handling
        if (error instanceof ParamError) {
            throw error;
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new ParamError(`[Db] connect error: ${errorMsg}`);
    }
}

/**
 * Find and connect to database - resolves database name or connection string
 * 
 * This function handles:
 * - Direct connection string (postgresql://... or mysql://...)
 * - Database name/label that gets resolved to dbConnectionString${CapitalizedName}
 * - Reading from params if no second parameter provided
 */
export async function dbFindAndConnect(
    context: Context,
    dbNameOrConnectionString?: string
): Promise<Db> {
    let dbName: string | undefined;
    let dbConnectionString: string | undefined;
    let dbProfile: boolean | undefined;
    
    // If second parameter is provided
    if (dbNameOrConnectionString) {
        // Check if it looks like a connection string (postgresql:// or mysql://)
        if (dbNameOrConnectionString.match(/^(postgresql|mysql):\/\/[^\s]+:[^\s]+@[^\s]+:\d+\/[^\s]+$/)) {
            dbName = undefined;
            dbConnectionString = dbNameOrConnectionString;
        } else {
            // Treat it as a database name/label
            dbName = dbNameOrConnectionString;
        }
    } else {
        // No second parameter - read from params
        const defs = {
            dbName: 'string',
            dbConnectionString: 'string',
            dbProfile: 'boolean default false',
        };
        
        const paramsConfig = context.params.getAll(defs);
        dbName = paramsConfig.dbName;
        dbConnectionString = paramsConfig.dbConnectionString;
        dbProfile = paramsConfig.dbProfile;
    }
    
    // Validate that we have either dbName or dbConnectionString
    if (!dbName && !dbConnectionString) {
        throw new ParamError('Db: either dbName or dbConnectionString must be specified');
    }
    
    // If dbName is provided, resolve it to connection string
    if (dbName) {
        const paramName = `dbConnectionString${capitalizeFirstLetter(dbName)}`;
        dbConnectionString = await context.params.get(paramName, 'string');
        if (!dbConnectionString) {
            throw new ParamError(
                `Db: cannot find dbConnectionString for dbName="${dbName}" (looked for param "${paramName}")`
            );
        }
    }
    
    // Connect using dedicated connect function
    // context.logger.notice(`[Db] connecting to database "${dbConnectionString}"`);
    // TODO: figure out the output of "--showUsedParams" in the case of the DB - stuff gets to "script" section that doesn't belong there.
    const db = await dbConnect(context, dbConnectionString!, dbName, dbProfile);
    
    // Test connection (connect() already tests if testConnection is true, but we can test explicitly here too)
    // The test is already done in db.connect() if config.testConnection is true
    
    return db;
}

/**
 * Initialize Db instance with context (auto-connects)
 * 
 * This is the standard "init" function that auto-initializes the DB component.
 * It calls dbFindAndConnect, optionally passing a second parameter.
 * 
 * Usage:
 * ```typescript
 * // Auto-initialize from params:
 * const db = await dbInit(context);
 * 
 * // Or with database name/label:
 * const db = await dbInit(context, 'local');
 * 
 * // Or with direct connection string:
 * const db = await dbInit(context, 'postgresql://user:pass@host:5432/dbname');
 * ```
 */
export async function dbInit(
    context: Context,
    dbNameOrConnectionString?: string
): Promise<Db> {
    return await dbFindAndConnect(context, dbNameOrConnectionString);
}

