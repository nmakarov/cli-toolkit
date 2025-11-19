/**
 * Database module types
 */

import type { Knex } from 'knex';

export type DatabaseClient = 'pg' | 'mysql2';

export interface DbConfig {
    connectionString: string;
    name?: string;
    testConnection?: boolean;
    profile?: boolean;
    pool?: {
        min?: number;
        max?: number;
    };
    acquireConnectionTimeout?: number;
    ssl?: {
        rejectUnauthorized?: boolean;
    };
    logger?: any;
}

export interface QueryLogEntry {
    sql: string;
    bindings: any[];
    executionTimeMs: string;
}

export interface DbInstance extends Knex {
    queriesLog?: QueryLogEntry[];
}

