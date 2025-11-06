/**
 * FileDatabase Types
 * 
 * Type definitions for the FileDatabase module - a versioned, file-based data storage system
 */

/**
 * Data types supported by FileDatabase
 */
export type DataType = "json-array" | "json-object" | "text" | "xml";

/**
 * Storage mode determines the file organization strategy
 */
export type StorageMode = "versioned" | "catalog" | "logs";

/**
 * File entry in version metadata
 */
export interface FileEntry {
    /** Sequential file number (1, 2, 3, ...) */
    number: number;
    /** Number of records in this file */
    recordsCount: number;
    /** Filename (e.g., "000001.json") */
    fileName: string;
    /** Optional custom synopsis data for this file */
    [key: string]: any;
}

/**
 * Version metadata structure
 */
export interface VersionMetadata {
    /** Version identifier (ISO8601 timestamp string) */
    version: string | null;
    /** Array of files in this version */
    files: FileEntry[];
    /** When this version was created */
    createdAt: string;
    /** When this version was last modified */
    modifiedAt: string;
    /** Total number of records across all files */
    totalRecords: number;
    /** Optional synopsis data calculated for the entire version */
    synopsis: any;
    /** Type of data stored in this version */
    dataType: DataType | null;
}

/**
 * FileDatabase configuration options
 */
export interface FileDatabaseConfig {
    /** Base path for all file storage (required) */
    basePath: string;
    /** Namespace subfolder (e.g., "harvested", "mocks") - default: "default" */
    namespace?: string;
    /** Table/collection name (e.g., "properties", "members") - optional */
    tableName?: string;
    /** Maximum number of versions to keep (older versions are deleted) - default: 5 */
    maxVersions?: number;
    /** Page size for chunked file writes (records per file) - default: 5000 */
    pageSize?: number;
    /** Whether to use metadata.json files (new structure) - default: true */
    useMetadata?: boolean;
    /** Minimum free disk space threshold in bytes - default: 100MB */
    freeSpaceThreshold?: number;
    /** Storage mode - default: "versioned" */
    storageMode?: StorageMode;
    /** Optional logger instance */
    logger?: any;
}

/**
 * Options for read operations
 */
export interface ReadOptions {
    /** Specific version to read (defaults to latest) */
    version?: string;
    /** Read next page of data (for pagination) */
    nextPage?: boolean;
    /** Number of records per page */
    pageSize?: number;
}

/**
 * Options for write operations
 */
export interface WriteOptions {
    /** Specific version to write to (defaults to current or creates new) */
    version?: string;
    /** Force creation of a new version */
    forceNewVersion?: boolean;
}

/**
 * Function signature for file-level synopsis calculation
 */
export type FileSynopsisFunction = (fileEntry: FileEntry, data: any) => FileEntry;

/**
 * Function signature for version-level synopsis calculation
 */
export type VersionSynopsisFunction = (metadata: VersionMetadata) => VersionMetadata;

/**
 * Result of figuring out what data to write and which file to use
 */
export interface WriteContext {
    /** Data to write to the current file */
    dataToWrite: any;
    /** Remaining data for next file (null if none) */
    dataLeftOver: any[] | null;
    /** Filename to write to */
    fileName: string;
}

/**
 * Catalog entry for catalog-based storage (API mocks)
 */
export interface CatalogEntry {
    /** HTTP method (GET, POST, etc.) */
    method: string;
    /** Host name */
    host: string;
    /** URL pathname */
    pathname: string;
    /** Query string */
    query: string;
    /** Reference to the response file */
    file: string;
    /** When this entry was created */
    timestamp: string;
    /** Optional request data (for POST/PUT) */
    requestData?: string | object;
    /** Optional operation identifier */
    operationId?: string;
    /** Optional mock name for easy reference */
    mockName?: string;
}

