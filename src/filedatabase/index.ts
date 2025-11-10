/**
 * FileDatabase - Versioned, file-based data storage system
 * 
 * Provides organized file storage with:
 * - Timestamp-based versioning
 * - Chunked/paginated file writes for large datasets
 * - Metadata tracking
 * - Backward compatibility with legacy structures
 * - Multiple storage modes (versioned, catalog, logs)
 */

import fs from "fs";
import path from "path";
import type {
    FileDatabaseConfig,
    VersionMetadata,
    FileEntry,
    ReadOptions,
    WriteOptions,
    WriteContext,
    FileSynopsisFunction,
    VersionSynopsisFunction,
    DataType,
} from "./types.js";
import { ensurePath, generateVersionName, getFileExtension, getFreeDiskSpace, bytesToHumanReadable, isTimestampFolder } from "./utils.js";
import { detectDataType, serializeData, deserializeData } from "./serializers.js";
import { ParamError } from "../errors.js";

/**
 * FileDatabase Error class
 */
export class FileDatabaseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FileDatabaseError";
    }
}

export class FileDatabase {
    private basePath: string;
    private namespace: string;
    private tableName: string | null = null;
    private versioned: boolean;
    private maxVersions: number;
    private pageSize: number;
    private useMetadata: boolean;
    private freeSpaceThreshold: number;
    private logger: any;

    // Current operation state
    private currentVersion: string | null = null;
    private currentVersionFolder: string | null = null;
    private currentFileNumber: number = 0;
    private currentRecord: number = 0;
    private hasReadFirstPage: boolean = false;
    private lastFileData: any = null;
    private metadata: VersionMetadata;

    // Synopsis calculation functions
    private fileSynopsisFunction: FileSynopsisFunction | null = null;
    private versionSynopsisFunction: VersionSynopsisFunction | null = null;

    constructor(config: FileDatabaseConfig) {
        // Validate required configuration
        if (!config.basePath) {
            throw new ParamError("[FileDatabase] basePath is required");
        }

        this.basePath = config.basePath;
        this.namespace = config.namespace || "default";
        this.tableName = config.tableName || null;
        this.versioned = config.versioned ?? true; // Default true for backward compatibility
        this.maxVersions = config.maxVersions || 5;
        this.pageSize = config.pageSize || 5000;
        this.useMetadata = config.useMetadata !== false; // Default true
        this.freeSpaceThreshold = config.freeSpaceThreshold || 100 * 1024 * 1024; // 100MB
        this.logger = config.logger || console;

        // Initialize metadata
        this.metadata = this.getDefaultMetadata();
    }

    /**
     * Get default metadata structure
     */
    private getDefaultMetadata(): VersionMetadata {
        return {
            version: this.currentVersion || null,
            files: [],
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            totalRecords: 0,
            synopsis: null,
            dataType: null,
        };
    }

    /**
     * Get the destination path (basePath/namespace/tableName[/version])
     */
    private getDestinationPath(version?: string): string {
        const errors = ["basePath", "namespace", "tableName"]
            .filter(prop => !this[prop as keyof this])
            .map(prop => `${prop} is not set`);
        if (errors.length) {
            throw new FileDatabaseError(`[FileDatabase] ${errors.join("; ")}`);
        }

        let parts = [this.basePath, this.namespace];
        if (this.tableName) {
            parts.push(...this.tableName.split('/'));
        }

        // Only add version folder if in versioned mode and version is specified
        if (this.versioned && version) {
            parts.push(version);
        }

        return path.resolve(...parts);
    }

    /**
     * Set current version and version folder
     */
    private async setCurrentVersion(version: string): Promise<void> {
        this.currentVersion = version;
        this.currentVersionFolder = await ensurePath(this.getDestinationPath(), version);
    }

    /**
     * Create a new version folder with comprehensive timestamp logic
     * Only works in versioned mode
     */
    private async makeNewVersion(): Promise<string> {
        if (!this.versioned) {
            throw new FileDatabaseError("makeNewVersion() only works in versioned mode");
        }

        // Reset in-memory metadata when creating a new version
        this.metadata = this.getDefaultMetadata();

        const existingVersions = await this.getVersions();
        let versionName: string;

        if (existingVersions.length > 0) {
            // Find the maximum timestamp among all existing versions
            const maxTimestamp = existingVersions.reduce((max, version) => {
                const versionDate = new Date(version.replace("Z", ""));
                const maxDate = new Date(max.replace("Z", ""));
                return versionDate > maxDate ? version : max;
            });

            // Increment the maximum timestamp by 1 second
            const maxDate = new Date(maxTimestamp.replace("Z", ""));
            const nextDate = new Date(maxDate.getTime() + 1000);
            versionName = nextDate.toISOString().split(".")[0] + "Z";
        } else {
            // No existing versions, use current timestamp
            const now = new Date();
            versionName = now.toISOString().split(".")[0] + "Z";
        }

        await this.setCurrentVersion(versionName);

        // Reset file numbering for new version
        this.currentFileNumber = 0;

        // Delete old versions if we exceed maxVersions
        const versions = await this.getVersions();
        while (versions.length > this.maxVersions) {
            const versionToDelete = path.resolve(this.getDestinationPath(), versions.shift()!);
            this.logger.debug?.(`[FileDatabase] Deleting old version: ${versionToDelete}`);
            await fs.promises.rm(versionToDelete, { recursive: true, force: true });
        }

        return versionName;
    }

    /**
     * Get list of all versions (sorted chronologically)
     * Only works in versioned mode
     */
    async getVersions(): Promise<string[]> {
        if (!this.versioned) {
            return []; // No versions in non-versioned mode
        }

        const destPath = this.getDestinationPath();

        try {
            await ensurePath(destPath);
            const items = await fs.promises.readdir(destPath);
            const versions = items.filter(item => {
                const itemPath = path.join(destPath, item);
                const stat = fs.statSync(itemPath);
                return stat.isDirectory() && isTimestampFolder(item);
            });

            return versions.sort();
        } catch (error) {
            return [];
        }
    }

    /**
     * Get the latest version (most recent timestamp)
     * Only works in versioned mode
     * @returns Latest version string or null if no versions
     */
    async getLatestVersion(): Promise<string | null> {
        if (!this.versioned) {
            throw new FileDatabaseError("getLatestVersion() only works in versioned mode");
        }

        const versions = await this.getVersions();
        if (versions.length === 0) {
            return null;
        }

        return versions[versions.length - 1];
    }

    /**
     * Check if any data exists in this table
     * Works for both versioned and non-versioned modes
     * @returns true if data exists
     */
    async hasData(): Promise<boolean> {
        const tablePath = this.getDestinationPath();

        if (!fs.existsSync(tablePath)) {
            return false;
        }

        if (this.versioned) {
            // Check for version folders
            const versions = await this.getVersions();
            return versions.length > 0;
        } else {
            // Check for any data files or metadata
            const items = await fs.promises.readdir(tablePath);
            return items.some(item =>
                item === 'metadata.json' ||
                item.match(/^\d{6}\.(json|txt|xml)$/) ||
                item.endsWith('.json')
            );
        }
    }

    /**
     * Auto-detect the data format in this table
     * Used when reading existing data
     * @returns Format detection result
     */
    async detectDataFormat(): Promise<{
        versioned: boolean;
        hasMetadata: boolean;
        dataType: DataType | null;
    }> {
        const tablePath = this.getDestinationPath();

        if (!fs.existsSync(tablePath)) {
            return { versioned: false, hasMetadata: false, dataType: null };
        }

        const items = await fs.promises.readdir(tablePath);

        // Check for metadata.json in root (non-versioned with metadata)
        if (items.includes('metadata.json')) {
            const metadata = JSON.parse(
                await fs.promises.readFile(path.join(tablePath, 'metadata.json'), 'utf8')
            );
            return {
                versioned: false,
                hasMetadata: true,
                dataType: metadata.dataType || null
            };
        }

        // Check for version folders
        const versionFolders = items.filter(item => {
            const itemPath = path.join(tablePath, item);
            const stat = fs.statSync(itemPath);
            return stat.isDirectory() && isTimestampFolder(item);
        });

        if (versionFolders.length > 0) {
            // Check if latest version has metadata
            const latestVersion = versionFolders.sort().pop()!;
            const versionMetadataPath = path.join(tablePath, latestVersion, 'metadata.json');

            return {
                versioned: true,
                hasMetadata: fs.existsSync(versionMetadataPath),
                dataType: null
            };
        }

        // Check for sequential files (legacy non-versioned)
        const dataFiles = items.filter(f => f.match(/^\d{6}\.(json|txt|xml)$/));
        if (dataFiles.length > 0) {
            return {
                versioned: false,
                hasMetadata: false,
                dataType: null
            };
        }

        return { versioned: false, hasMetadata: false, dataType: null };
    }

    /**
     * Load metadata from JSON file
     */
    private async loadMetadataJson(version: string): Promise<VersionMetadata | null> {
        const metadataFile = path.join(this.getDestinationPath(), version, "metadata.json");
        if (fs.existsSync(metadataFile)) {
            try {
                const rawData = await fs.promises.readFile(metadataFile, "utf8");
                return JSON.parse(rawData);
            } catch (e) {
                throw new FileDatabaseError(`Failed to read metadata for version "${version}": ${(e as Error).message}`);
            }
        }
        return null;
    }

    /**
     * Build metadata by scanning files in a version folder (backward compatibility)
     * Reads all files to get accurate counts - used when synopsis calculation is needed
     */
    private async figureMetadataFromVersionFiles(version: string): Promise<VersionMetadata> {
        const versionPath = path.join(this.getDestinationPath(), version);

        if (!fs.existsSync(versionPath)) {
            return this.getDefaultMetadata();
        }

        const files = (await fs.promises.readdir(versionPath))
            .filter(file => file !== "metadata.json" && !file.startsWith("."))
            .sort();

        const metadata = this.getDefaultMetadata();
        metadata.version = version;
        metadata.files = [];

        let totalRecords = 0;
        let detectedDataType: DataType | null = null;

        for (let i = 0; i < files.length; i++) {
            const fileName = files[i];
            const filePath = path.join(versionPath, fileName);

            try {
                const rawData = await fs.promises.readFile(filePath, "utf8");
                const extension = path.extname(fileName).toLowerCase();
                let dataType: DataType = "text";

                if (extension === ".json") {
                    dataType = "json-array";
                } else if (extension === ".xml") {
                    dataType = "xml";
                }

                const fileData = deserializeData(rawData, dataType);
                const recordsCount = Array.isArray(fileData) ? fileData.length : 1;

                if (detectedDataType === null) {
                    detectedDataType = detectDataType(fileData);
                }

                const fileInfo: FileEntry = {
                    number: i + 1,
                    recordsCount,
                    fileName,
                };

                metadata.files.push(fileInfo);
                totalRecords += recordsCount;
            } catch (error) {
                this.logger.error?.(`[FileDatabase] Failed to read file ${fileName}: ${(error as Error).message}`);
            }
        }

        metadata.totalRecords = totalRecords;
        metadata.dataType = detectedDataType;

        return metadata;
    }

    /**
     * Build metadata optimized - only reads first and last files
     * Assumes all middle files have the same record count as the first file
     * Much faster for large datasets with many files
     */
    private async buildMetadataOptimized(version: string): Promise<VersionMetadata> {
        const versionPath = path.join(this.getDestinationPath(), version);

        if (!fs.existsSync(versionPath)) {
            return this.getDefaultMetadata();
        }

        const files = (await fs.promises.readdir(versionPath))
            .filter(file => file !== "metadata.json" && !file.startsWith("."))
            .sort();

        if (files.length === 0) {
            return this.getDefaultMetadata();
        }

        const metadata = this.getDefaultMetadata();
        metadata.version = version;
        metadata.files = files.map((fileName, index) => ({
            number: index + 1,
            recordsCount: 0,
            fileName,
        }));

        // Read first file to determine data type and standard record count
        const firstFile = metadata.files[0];
        const firstFilePath = path.join(versionPath, firstFile.fileName);
        const firstFileRaw = await fs.promises.readFile(firstFilePath, "utf8");

        let firstFileData: any;
        try {
            firstFileData = JSON.parse(firstFileRaw);
        } catch (e) {
            firstFileData = firstFileRaw;
        }

        metadata.dataType = detectDataType(firstFileData);

        // Only proceed with optimization for json-array data
        if (metadata.dataType === "json-array") {
            const firstFileCount = Array.isArray(firstFileData) ? firstFileData.length : 1;
            firstFile.recordsCount = firstFileCount;

            // Assume all middle files have the same count as the first
            for (let i = 1; i < metadata.files.length - 1; i++) {
                metadata.files[i].recordsCount = firstFileCount;
            }

            // Read last file to get its actual count (might be partial)
            if (files.length > 1) {
                const lastFile = metadata.files[metadata.files.length - 1];
                const lastFilePath = path.join(versionPath, lastFile.fileName);
                const lastFileRaw = await fs.promises.readFile(lastFilePath, "utf8");
                const lastFileData = deserializeData(lastFileRaw, metadata.dataType);
                lastFile.recordsCount = Array.isArray(lastFileData) ? lastFileData.length : 1;
            }

            // Calculate total records
            metadata.totalRecords = metadata.files.reduce((sum, file) => sum + file.recordsCount, 0);
        } else {
            // For non-array data, count each file as 1 record
            metadata.files.forEach(file => {
                file.recordsCount = 1;
            });
            metadata.totalRecords = files.length;
        }

        return metadata;
    }

    /**
     * Figure out metadata - tries JSON first, then builds from files
     * Uses optimized building when no synopsis calculation is needed
     */
    private async figureMetadata(version: string, useOptimized: boolean = true): Promise<VersionMetadata> {
        if (this.useMetadata) {
            const metadata = await this.loadMetadataJson(version);
            if (metadata) {
                return metadata;
            }
        }
        
        // Fallback: build from files
        // Use optimized version (only reads first+last) when no synopsis needed
        if (useOptimized && !this.fileSynopsisFunction && !this.versionSynopsisFunction) {
            return await this.buildMetadataOptimized(version);
        }
        
        // Use full version (reads all files) when synopsis calculation needed
        return await this.figureMetadataFromVersionFiles(version);
    }

    /**
     * Load version metadata (main entry point for loading)
     */
    private async loadVersionMetadata(version: string): Promise<VersionMetadata> {
        const metadata = await this.figureMetadata(version);
        this.metadata = metadata;
        return metadata;
    }

    /**
     * Save version metadata to file
     */
    private async saveVersionMetadata(metadata?: VersionMetadata): Promise<void> {
        if (!this.useMetadata) {
            return;
        }

        const metadataToSave = metadata || this.metadata;
        let metadataFile: string;

        if (this.versioned) {
            // Versioned mode: metadata in version folder
            if (!this.currentVersion) {
                return;
            }
            metadataFile = path.join(this.getDestinationPath(), this.currentVersion, "metadata.json");
        } else {
            // Non-versioned mode: metadata in root table folder
            metadataFile = path.join(this.getDestinationPath(), "metadata.json");
        }

        await fs.promises.writeFile(metadataFile, JSON.stringify(metadataToSave, null, 4), "utf8");
    }

    /**
     * Create a new file entry in metadata
     */
    private makeNewFile(): void {
        this.currentFileNumber = (this.currentFileNumber || 0) + 1;

        const dataType = this.metadata.dataType || "json-array";
        const fileEntry: FileEntry = {
            number: this.currentFileNumber,
            recordsCount: 0,
            fileName: `${this.currentFileNumber.toString().padStart(6, "0")}.${getFileExtension(dataType)}`,
        };

        this.metadata.files.push(fileEntry);
        this.lastFileData = null;

        this.logger.debug?.(`[FileDatabase] Created new file: ${fileEntry.fileName}, fileNumber: ${this.currentFileNumber}`);
    }

    /**
     * Figure out what data to write and which file to use (for pagination)
     */
    private figureOutDataAndFileToWrite(data: any): WriteContext {
        let dataToWrite: any;
        let dataLeftOver: any[] | null;

        const lastFile = this.metadata.files[this.metadata.files.length - 1];
        const lastFileRecordsCount = lastFile.recordsCount;

        if (Array.isArray(data)) {
            // For arrays, handle pagination
            if (lastFileRecordsCount < this.pageSize) {
                // Try to append to existing file if there's space
                dataToWrite = [...(this.lastFileData || []), ...data.slice(0, this.pageSize - lastFileRecordsCount)];
                dataLeftOver = data.slice(this.pageSize - lastFileRecordsCount);
            } else {
                // Last file is full, create a new file
                this.makeNewFile();
                dataToWrite = data.slice(0, this.pageSize);
                dataLeftOver = data.slice(this.pageSize);
            }
            this.lastFileData = dataToWrite;
        } else {
            // For non-arrays, write as-is
            dataToWrite = data;
            dataLeftOver = null;
        }

        const fileName = this.metadata.files[this.metadata.files.length - 1].fileName;

        this.logger.debug?.(
            `[FileDatabase] figureOutDataAndFileToWrite: filename=${fileName}, dataToWrite.length=${Array.isArray(dataToWrite) ? dataToWrite.length : "N/A"}, lastFileRecordsCount=${lastFileRecordsCount}`
        );

        return { dataToWrite, dataLeftOver, fileName };
    }

    /**
     * Calculate file-level synopsis if function is set
     */
    private calculateFileSynopsis(data: any, fileIndex: number = this.metadata.files.length - 1): void {
        if (!this.fileSynopsisFunction) {
            return;
        }
        const fileInfo = this.metadata.files[fileIndex];
        const enhancedFileInfo = this.fileSynopsisFunction(fileInfo, data);
        this.metadata.files[fileIndex] = enhancedFileInfo;
    }

    /**
     * Calculate version-level synopsis if function is set
     */
    private calculateVersionSynopsis(): void {
        if (!this.versionSynopsisFunction) {
            return;
        }
        const enhancedMetadata = this.versionSynopsisFunction(this.metadata);
        this.metadata = enhancedMetadata;
    }

    /**
     * Update metadata after writing data
     */
    private updateMetadata(dataToWrite: any, fileName?: string): void {
        let currentFile: FileEntry;

        if (fileName) {
            // Find the specific file by filename
            const foundFile = this.metadata.files.find(file => file.fileName === fileName);
            if (!foundFile) {
                this.logger.warn?.(`[FileDatabase] File ${fileName} not found in metadata, using last file`);
                currentFile = this.metadata.files[this.metadata.files.length - 1];
            } else {
                currentFile = foundFile;
            }
        } else {
            // Get the current file info from metadata (always the last file)
            currentFile = this.metadata.files[this.metadata.files.length - 1];
        }

        // Calculate the actual records count for the data being written
        const recordsCount = Array.isArray(dataToWrite) ? dataToWrite.length : 1;

        // Update existing file entry with the correct records count
        currentFile.recordsCount = recordsCount;

        // Find the file index for synopsis calculation
        const fileIndex = this.metadata.files.indexOf(currentFile);
        if (fileIndex !== -1) {
            this.calculateFileSynopsis(dataToWrite, fileIndex);
        }

        // Update version metadata
        this.metadata.version = this.currentVersion;
        this.metadata.modifiedAt = new Date().toISOString();
        this.metadata.dataType = detectDataType(dataToWrite);

        // Recalculate total records by summing all file records counts
        this.metadata.totalRecords = this.metadata.files.reduce((sum, file) => sum + (file.recordsCount || 0), 0);

        this.logger.debug?.(
            `[FileDatabase] Updated metadata for file ${currentFile.fileName}: recordsCount=${recordsCount}, totalRecords=${this.metadata.totalRecords}`
        );
    }

    /**
     * Safe write with disk space check
     */
    private async safeWrite(filePath: string, data: any): Promise<void> {
        const serializedData = serializeData(data);
        const dir = path.dirname(filePath);
        const requiredBytes = Buffer.byteLength(serializedData, "utf8");

        // Check disk space
        const freeBytes = getFreeDiskSpace(dir);
        if (freeBytes !== null) {
            if (freeBytes < requiredBytes) {
                throw new FileDatabaseError(
                    `Not enough disk space. Required: ${bytesToHumanReadable(requiredBytes)}, Free: ${bytesToHumanReadable(freeBytes)}`
                );
            }

            if (freeBytes < this.freeSpaceThreshold) {
                this.logger.warn?.(`Low disk space warning: only ${bytesToHumanReadable(freeBytes)} left`);
            }
        }

        try {
            await fs.promises.writeFile(filePath, serializedData, "utf8");
            this.logger.debug?.(`[FileDatabase] Wrote ${bytesToHumanReadable(requiredBytes)} to ${filePath}`);
        } catch (error) {
            throw new FileDatabaseError(`Failed to write file ${filePath}: ${(error as Error).message}`);
        }
    }

    /**
     * Prepare the instance for read or write operations
     * This discovers state and sets up internal members based on mode and current data
     */
    private async prepare({ write, read, version }: { write?: boolean; read?: boolean; version?: string }): Promise<void> {
        if (write) {
            if (this.versioned) {
                // Versioned mode
                if (this.currentVersion === null) {
                    await this.makeNewVersion();
                    this.metadata = this.getDefaultMetadata();
                    this.metadata.version = this.currentVersion;
                    this.makeNewFile();
                } else {
                    // For existing versions, load the metadata if not already loaded
                    if (!this.metadata.files.length) {
                        this.metadata = await this.figureMetadata(this.currentVersion);
                    }
                }
            } else {
                // Non-versioned mode - ensure table directory exists
                await ensurePath(this.getDestinationPath());

                // Non-versioned mode - auto-detect useMetadata if not set
                if (this.useMetadata === true) {
                    // Try to load existing metadata, create new if doesn't exist
                    const metadataPath = path.join(this.getDestinationPath(), 'metadata.json');
                    if (fs.existsSync(metadataPath)) {
                        try {
                            const rawData = await fs.promises.readFile(metadataPath, 'utf8');
                            this.metadata = JSON.parse(rawData);
                        } catch (e) {
                            this.metadata = this.getDefaultMetadata();
                        }
                    } else {
                        this.metadata = this.getDefaultMetadata();
                        this.makeNewFile();
                    }
                } else {
                    // No metadata mode - just create default metadata
                    this.metadata = this.getDefaultMetadata();
                    this.makeNewFile();
                }
            }
        } else if (read) {
            if (this.versioned) {
                // Versioned mode
                const versions = await this.getVersions();
                if (versions.length === 0) {
                    throw new FileDatabaseError("[FileDatabase] No versions found, cannot read");
                }

                if (version) {
                    if (!versions.includes(version)) {
                        throw new FileDatabaseError(`[FileDatabase] Version "${version}" not found`);
                    }
                    await this.setCurrentVersion(version);
                } else {
                    await this.setCurrentVersion(versions[versions.length - 1]);
                }

                if (!this.metadata.files.length) {
                    this.metadata = await this.figureMetadata(this.currentVersion!);
                }
            } else {
                // Non-versioned mode
                this.currentVersion = null; // No version concept

                // Auto-detect useMetadata if not explicitly set
                if (this.useMetadata === undefined) {
                    const format = await this.detectDataFormat();
                    this.useMetadata = format.hasMetadata;
                }

                if (this.useMetadata) {
                    // Load metadata from root
                    const metadataPath = path.join(this.getDestinationPath(), 'metadata.json');
                    if (fs.existsSync(metadataPath)) {
                        try {
                            const rawData = await fs.promises.readFile(metadataPath, 'utf8');
                            this.metadata = JSON.parse(rawData);
                        } catch (e) {
                            throw new FileDatabaseError(`Failed to read metadata: ${(e as Error).message}`);
                        }
                    } else {
                        throw new FileDatabaseError("[FileDatabase] No metadata found in non-versioned mode");
                    }
                } else {
                    // Figure metadata from files
                    this.metadata = await this.figureMetadataFromVersionFiles('');
                }
            }
        }
    }

    /**
     * Write data to the file database
     */
    async write(data: any, options: WriteOptions = {}): Promise<void> {
        // Check for forceNewVersion in non-versioned mode
        if (options.forceNewVersion && !this.versioned) {
            throw new FileDatabaseError("Cannot use forceNewVersion in non-versioned mode");
        }

        // Prepare for writing
        await this.prepare({ write: true });

        // Force new version if requested (versioned mode only)
        if (options.forceNewVersion) {
            await this.makeNewVersion();
            this.metadata = this.getDefaultMetadata();
            this.metadata.version = this.currentVersion;
            this.makeNewFile();
        }

        let { dataToWrite, dataLeftOver, fileName } = this.figureOutDataAndFileToWrite(data);

        // Write first batch
        const destPath = this.getDestinationPath(this.currentVersion || undefined);
        await this.safeWrite(path.join(destPath, fileName), dataToWrite);
        this.updateMetadata(dataToWrite, fileName);

        // Handle pagination for remaining data (arrays only)
        while (dataLeftOver && dataLeftOver.length > 0) {
            const writeContext = this.figureOutDataAndFileToWrite(dataLeftOver);
            await this.safeWrite(path.join(destPath, writeContext.fileName), writeContext.dataToWrite);
            this.updateMetadata(writeContext.dataToWrite, writeContext.fileName);
            dataLeftOver = writeContext.dataLeftOver;
        }

        // Calculate version synopsis
        this.calculateVersionSynopsis();

        // Save metadata to file
        if (this.useMetadata) {
            await this.saveVersionMetadata(this.metadata);
        }
    }

    /**
     * Read data from the file database
     */
    async read(options: ReadOptions = {}): Promise<any> {
        const { version, nextPage = false, pageSize } = options;

        // Prepare for reading
        await this.prepare({ read: true, version });

        // Check for non-paginated data types
        const isNonPaginatedData =
            this.metadata.dataType === "text" || this.metadata.dataType === "xml" || this.metadata.dataType === "json-object";

        if (isNonPaginatedData) {
            // For text/xml/object data, return all content
            const file = this.metadata.files[0];
            const filePath = path.join(this.getDestinationPath(this.currentVersion || undefined), file.fileName);
            try {
                const rawData = await fs.promises.readFile(filePath, "utf8");
                return deserializeData(rawData, this.metadata.dataType!);
            } catch (error) {
                throw new FileDatabaseError(`Failed to read file ${file.fileName}: ${(error as Error).message}`);
            }
        }

        // Handle paginated data (JSON arrays)
        let effectivePageSize: number;

        if (nextPage && this.hasReadFirstPage) {
            // Move to next page
            effectivePageSize = pageSize || this.pageSize;
            this.currentRecord += effectivePageSize;
        } else if (!nextPage) {
            // If not paginating, read all records (unless pageSize is explicitly provided)
            effectivePageSize = pageSize !== undefined ? pageSize : this.metadata.totalRecords;
            this.currentRecord = 0;
        } else {
            // First call with nextPage=true (no previous page read)
            effectivePageSize = pageSize || this.pageSize;
        }

        // If beyond total records, return empty array
        if (this.currentRecord >= this.metadata.totalRecords) {
            return [];
        }

        const result: any[] = [];
        let recordsRead = 0;
        let currentFileIndex = 0;
        let currentFileOffset = 0;

        // Calculate which file and offset to start from
        let totalRecords = 0;
        for (let i = 0; i < this.metadata.files.length; i++) {
            const file = this.metadata.files[i];
            if (this.currentRecord < totalRecords + file.recordsCount) {
                currentFileIndex = i;
                currentFileOffset = totalRecords;
                break;
            }
            totalRecords += file.recordsCount;
        }

        // Read from files
        let cumulativeRecords = currentFileOffset;
        for (let i = currentFileIndex; i < this.metadata.files.length && recordsRead < effectivePageSize; i++) {
            const file = this.metadata.files[i];
            const filePath = path.join(this.getDestinationPath(this.currentVersion || undefined), file.fileName);

            try {
                const rawData = await fs.promises.readFile(filePath, "utf8");
                const fileData = deserializeData(rawData, this.metadata.dataType!);

                let startIndex = 0;
                if (i === currentFileIndex) {
                    startIndex = this.currentRecord - cumulativeRecords;
                }

                const endIndex = Math.min(startIndex + (effectivePageSize - recordsRead), fileData.length);
                const recordsFromThisFile = fileData.slice(startIndex, endIndex);

                result.push(...recordsFromThisFile);
                recordsRead += recordsFromThisFile.length;

                cumulativeRecords += file.recordsCount;
            } catch (error) {
                throw new FileDatabaseError(`Failed to read file ${file.fileName}: ${(error as Error).message}`);
            }
        }

        // Mark page as read for pagination tracking
        // When nextPage=true, we're explicitly paginating
        // When nextPage=false with explicit pageSize, we're also paginating (starting from beginning)
        if (result.length > 0) {
            if (nextPage || (pageSize !== undefined && pageSize < this.metadata.totalRecords)) {
                this.hasReadFirstPage = true;
            }
        }

        return result;
    }

    /**
     * Set the starting record for pagination (1-based index)
     */
    setStartRecord(startRecord: number): void {
        this.currentRecord = startRecord - 1;
        this.hasReadFirstPage = false;
    }

    /**
     * Reset read pagination state
     */
    resetPagination(): void {
        this.currentRecord = 0;
        this.hasReadFirstPage = false;
    }

    /**
     * Set file-level synopsis calculation function
     */
    setFileSynopsisFunction(fn: FileSynopsisFunction): void {
        this.fileSynopsisFunction = fn;
    }

    /**
     * Set version-level synopsis calculation function
     */
    setVersionSynopsisFunction(fn: VersionSynopsisFunction): void {
        this.versionSynopsisFunction = fn;
    }

    /**
     * Get current version name
     */
    getCurrentVersion(): string | null {
        return this.currentVersion;
    }

    /**
     * Get current metadata
     */
    getMetadata(): VersionMetadata {
        return { ...this.metadata };
    }
}

// Export types
export type {
    FileDatabaseConfig,
    VersionMetadata,
    FileEntry,
    ReadOptions,
    WriteOptions,
    FileSynopsisFunction,
    VersionSynopsisFunction,
    DataType,
    StorageMode,
    CatalogEntry,
} from "./types.js";

// Export synopsis functions
export { defaultFileSynopsisFunction, defaultVersionSynopsisFunction } from "./synopsis-functions.js";
