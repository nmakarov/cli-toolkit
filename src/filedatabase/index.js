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













import { ensurePath, getFileExtension, getFreeDiskSpace, bytesToHumanReadable, isTimestampFolder } from "./utils.js";
import { detectDataType, serializeData, deserializeData } from "./serializers.js";
import { ParamError, FileDatabaseError } from "../errors.js";

export { FileDatabaseError };

export class FileDatabase {
    basePath;
    namespace;
    tableName = null;
    versioned;
    maxVersions;
    pageSize;
    useMetadata;
    freeSpaceThreshold;
    logger;

    // Current operation state
    currentVersion = null;
    currentVersionFolder = null;
    currentFileNumber = 0;
    currentRecord = 0;
    hasReadFirstPage = false;
    lastFileData = null;
    /** Cache of the last JSON file parsed during paginated reads (avoid re-parse per page). */
    readFileCache = null; // { filePath: string, data: any[] } | null
    metadata;

    // Synopsis calculation functions
    fileSynopsisFunction = null;
    versionSynopsisFunction = null;

    /**
     * Constructor - accepts context as first parameter (new pattern)
     * or config object (legacy pattern for backward compatibility)
     */
    constructor(contextOrConfig, options) {
        let config;
        
        // Check if first parameter is Context (has params property)
        if (contextOrConfig && typeof contextOrConfig === "object" && "params" in contextOrConfig) {
            // New pattern: context is first parameter
            const context = contextOrConfig ;
            const opts = options || {};
            
            // Get configuration from context.params (module "filedatabase" for --showUsedParams grouping)
            const defs = {
                basePath: "string default ./data",
                namespace: "string default default",
                tableName: "string",
                maxVersions: "number default 5",
                pageSize: "number default 5000",
            };
            const discovered = context.params.getAllForModule(defs);
            config = { ...discovered, ...opts, logger: context.logger } ;
        } else {
            // Legacy pattern: config object
            config = contextOrConfig ;
        }
        
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
     * Initialize FileDatabase from context and options.
     * Params are read via getAllForModule("filedatabase", defs) for --showUsedParams grouping.
     */
    static init(context, options) {
        return new FileDatabase(context, options ?? {});
    }

    /**
     * Get default metadata structure
     */
    getDefaultMetadata() {
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
    getDestinationPath(version) {
        const errors = ["basePath", "namespace", "tableName"]
            .filter(prop => !this[prop ])
            .map(prop => `${prop} is not set`);
        if (errors.length) {
            throw new FileDatabaseError(`[FileDatabase] ${errors.join("; ")}`);
        }

        const parts = [this.basePath, this.namespace];
        if (this.tableName) {
            parts.push(...this.tableName.split("/"));
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
    async setCurrentVersion(version) {
        this.currentVersion = version;
        this.currentVersionFolder = await ensurePath(this.getDestinationPath(), version);
    }

    /**
     * Create a new version folder named with the current UTC second.
     * Only works in versioned mode.
     *
     * Clash protection: if that name already exists (two writers in the same
     * second, or wall clock behind the latest version), advance +1s until free.
     * Do NOT always derive from max(existing)+1s — that made successive harvests
     * hours apart still land one second apart on disk.
     */
    async makeNewVersion() {
        if (!this.versioned) {
            throw new FileDatabaseError("makeNewVersion() only works in versioned mode");
        }

        // Reset in-memory metadata when creating a new version
        this.metadata = this.getDefaultMetadata();

        const existingVersions = await this.getVersions();
        const existingSet = new Set(existingVersions);

        let candidateMs = Date.now();
        if (existingVersions.length > 0) {
            let maxMs = 0;
            for (const version of existingVersions) {
                const ms = new Date(version).getTime();
                if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
            }
            // Same-second clash or clock behind latest folder — start just after it.
            if (candidateMs <= maxMs) {
                candidateMs = maxMs + 1000;
            }
        }

        let versionName = new Date(candidateMs).toISOString().split(".")[0] + "Z";
        while (existingSet.has(versionName)) {
            candidateMs += 1000;
            versionName = new Date(candidateMs).toISOString().split(".")[0] + "Z";
        }

        await this.setCurrentVersion(versionName);

        // Reset file numbering for new version
        this.currentFileNumber = 0;

        // Delete old versions if we exceed maxVersions
        const versions = await this.getVersions();
        while (versions.length > this.maxVersions) {
            const versionToDelete = path.resolve(this.getDestinationPath(), versions.shift());
            this.logger.silly?.(`[FileDatabase] Deleting old version: ${versionToDelete}`);
            await fs.promises.rm(versionToDelete, { recursive: true, force: true });
        }

        return versionName;
    }

    /**
     * Get list of all versions (sorted chronologically)
     * Only works in versioned mode
     */
    async getVersions() {
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
    async getLatestVersion() {
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
    async hasData() {
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
                item === "metadata.json" ||
                item.match(/^\d{6}\.(json|txt|xml)$/) ||
                item.endsWith(".json")
            );
        }
    }

    /**
     * Auto-detect the data format in this table
     * Used when reading existing data
     * @returns Format detection result
     */
    async detectDataFormat()



    {
        const tablePath = this.getDestinationPath();

        if (!fs.existsSync(tablePath)) {
            return { versioned: false, hasMetadata: false, dataType: null };
        }

        const items = await fs.promises.readdir(tablePath);

        // Check for metadata.json in root (non-versioned with metadata)
        if (items.includes("metadata.json")) {
            const metadata = JSON.parse(
                await fs.promises.readFile(path.join(tablePath, "metadata.json"), "utf8")
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
            const latestVersion = versionFolders.sort().pop();
            const versionMetadataPath = path.join(tablePath, latestVersion, "metadata.json");

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
    async loadMetadataJson(version) {
        const metadataFile = path.join(this.getDestinationPath(), version, "metadata.json");
        if (fs.existsSync(metadataFile)) {
            try {
                const rawData = await fs.promises.readFile(metadataFile, "utf8");
                return JSON.parse(rawData);
            } catch (e) {
                throw new FileDatabaseError(`Failed to read metadata for version "${version}": ${(e ).message}`);
            }
        }
        return null;
    }

    /**
     * Build metadata by scanning files in a version folder (backward compatibility)
     * Reads all files to get accurate counts - used when synopsis calculation is needed
     */
    async figureMetadataFromVersionFiles(version) {
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
        let detectedDataType = null;

        for (let i = 0; i < files.length; i++) {
            const fileName = files[i];
            const filePath = path.join(versionPath, fileName);

            try {
                const rawData = await fs.promises.readFile(filePath, "utf8");
                const extension = path.extname(fileName).toLowerCase();
                let dataType = "text";

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

                const fileInfo = {
                    number: i + 1,
                    recordsCount,
                    fileName,
                };

                metadata.files.push(fileInfo);
                totalRecords += recordsCount;
            } catch (error) {
                this.logger.error?.(`[FileDatabase] Failed to read file ${fileName}: ${(error ).message}`);
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
    async buildMetadataOptimized(version) {
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

        let firstFileData;
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
    async figureMetadata(version, useOptimized = true) {
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
    async loadVersionMetadata(version) {
        const metadata = await this.figureMetadata(version);
        this.metadata = metadata;
        return metadata;
    }

    /**
     * Save version metadata to file
     */
    async saveVersionMetadata(metadata) {
        if (!this.useMetadata) {
            return;
        }

        const metadataToSave = metadata || this.metadata;
        let metadataFile;

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
    makeNewFile() {
        this.currentFileNumber = (this.currentFileNumber || 0) + 1;

        const dataType = this.metadata.dataType || "json-array";
        const fileEntry = {
            number: this.currentFileNumber,
            recordsCount: 0,
            fileName: `${this.currentFileNumber.toString().padStart(6, "0")}.${getFileExtension(dataType)}`,
        };

        this.metadata.files.push(fileEntry);
        this.lastFileData = null;

        this.logger.silly?.(`[FileDatabase] Created new file: ${fileEntry.fileName}, fileNumber: ${this.currentFileNumber}`);
    }

    /**
     * Figure out what data to write and which file to use (for pagination)
     * @param data - Data to write
     * @param targetFileIndex - Optional index of existing file to overwrite (when customMetadata matches)
     * @param forceNewFile - If true, always create a new file (when customMetadata provided but no match)
     */
    figureOutDataAndFileToWrite(data, targetFileIndex = null, forceNewFile = false) {
        let dataToWrite;
        let dataLeftOver;

        // Detect data type from incoming data
        // Always use the incoming data's type to ensure correct file extension
        const incomingDataType = detectDataType(data);
        if (this.metadata.dataType !== incomingDataType) {
            this.metadata.dataType = incomingDataType;
        }

        // If targetFileIndex is provided, use that file (overwrite existing file with matching customMetadata)
        if (targetFileIndex !== null && targetFileIndex < this.metadata.files.length) {
            const targetFile = this.metadata.files[targetFileIndex];
            // For non-array data, overwrite the file
            if (!Array.isArray(data)) {
                dataToWrite = data;
                dataLeftOver = null;
                return { dataToWrite, dataLeftOver, fileName: targetFile.fileName };
            } else {
                // For arrays, start fresh in the target file (don't append)
                dataToWrite = data.slice(0, this.pageSize);
                dataLeftOver = data.slice(this.pageSize);
                this.lastFileData = dataToWrite;
                return { dataToWrite, dataLeftOver, fileName: targetFile.fileName };
            }
        }

        // If forceNewFile is true (customMetadata provided but no match), create a new file
        // Skip the initial file creation if forceNewFile is true to avoid creating an extra empty file
        let newlyCreatedFileIndex = null;
        if (forceNewFile) {
            const filesBeforeCreate = this.metadata.files.length;
            this.makeNewFile();
            newlyCreatedFileIndex = filesBeforeCreate; // Index of the newly created file
            this.logger.silly?.(`[FileDatabase] Creating new file for unique custom metadata combination, fileNumber: ${this.currentFileNumber}`);
        } else if (this.metadata.files.length === 0) {
            // If no files exist yet and we're not forcing a new file, create the first file
            this.makeNewFile();
        }

        // Get the last file (which might be the one we just created)
        const lastFile = this.metadata.files[this.metadata.files.length - 1];
        const lastFileRecordsCount = lastFile.recordsCount;
        
        // Verify that if we created a new file, we're using it
        if (forceNewFile && newlyCreatedFileIndex !== null) {
            const newlyCreatedFile = this.metadata.files[newlyCreatedFileIndex];
            if (newlyCreatedFile && newlyCreatedFile.fileName !== lastFile.fileName) {
                this.logger.warn?.(`[FileDatabase] Warning: Newly created file ${newlyCreatedFile.fileName} doesn't match last file ${lastFile.fileName}`);
            }
        }
        
        // For non-array data (text/xml/object), check if we need a new file with correct extension
        // But skip this check if forceNewFile is true - we already created the file we need
        if (!Array.isArray(data) && !forceNewFile) {
            const lastFileExtension = path.extname(lastFile.fileName);
            const expectedExtension = `.${getFileExtension(incomingDataType)}`;
            // If the last file has wrong extension, create a new file with correct extension
            // Check even if recordsCount is 0 (empty file) - we want correct extension for new writes
            if (lastFileExtension !== expectedExtension) {
                // Only create new file if the existing one has content, otherwise we'll use it
                if (lastFileRecordsCount > 0) {
                    this.makeNewFile();
                } else {
                    // File is empty, update its name to have correct extension
                    lastFile.fileName = `${this.currentFileNumber.toString().padStart(6, "0")}.${getFileExtension(incomingDataType)}`;
                }
            }
        } else if (!Array.isArray(data) && forceNewFile) {
            // If forceNewFile is true, ensure the newly created file has the correct extension
            const lastFileExtension = path.extname(lastFile.fileName);
            const expectedExtension = `.${getFileExtension(incomingDataType)}`;
            if (lastFileExtension !== expectedExtension) {
                lastFile.fileName = `${this.currentFileNumber.toString().padStart(6, "0")}.${getFileExtension(incomingDataType)}`;
            }
        }

        if (Array.isArray(data)) {
            // For arrays, handle pagination
            // If forceNewFile is true, write fresh data to the new file (don't append)
            if (forceNewFile) {
                // Write fresh data to the newly created file
                dataToWrite = data.slice(0, this.pageSize);
                dataLeftOver = data.slice(this.pageSize);
                this.lastFileData = dataToWrite;
            } else if (lastFileRecordsCount < this.pageSize) {
                // Try to append to existing file if there's space
                dataToWrite = [...(this.lastFileData || []), ...data.slice(0, this.pageSize - lastFileRecordsCount)];
                dataLeftOver = data.slice(this.pageSize - lastFileRecordsCount);
                this.lastFileData = dataToWrite;
            } else {
                // Last file is full, create a new file
                this.makeNewFile();
                dataToWrite = data.slice(0, this.pageSize);
                dataLeftOver = data.slice(this.pageSize);
                this.lastFileData = dataToWrite;
            }
        } else {
            // For non-arrays, write as-is
            dataToWrite = data;
            dataLeftOver = null;
        }

        // Get the file name - if forceNewFile is true, we just created a new file, so use that one
        // Otherwise, use the last file (which might have been created earlier or is being reused)
        const fileName = this.metadata.files[this.metadata.files.length - 1].fileName;

        this.logger.silly?.(
            `[FileDatabase] figureOutDataAndFileToWrite: filename=${fileName}, forceNewFile=${forceNewFile}, targetFileIndex=${targetFileIndex}, dataToWrite.length=${Array.isArray(dataToWrite) ? dataToWrite.length : "N/A"}, lastFileRecordsCount=${lastFileRecordsCount}`
        );

        return { dataToWrite, dataLeftOver, fileName };
    }

    /**
     * Calculate file-level synopsis if function is set
     */
    calculateFileSynopsis(data, fileIndex = this.metadata.files.length - 1) {
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
    calculateVersionSynopsis() {
        if (!this.versionSynopsisFunction) {
            return;
        }
        const enhancedMetadata = this.versionSynopsisFunction(this.metadata);
        this.metadata = enhancedMetadata;
    }

    /**
     * Update metadata after writing data
     */
    updateMetadata(dataToWrite, fileName, customMetadata) {
        let currentFile;

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

        // Add custom metadata fields if provided
        if (customMetadata) {
            Object.assign(currentFile, customMetadata);
        }

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

        this.logger.silly?.(
            `[FileDatabase] Updated metadata for file ${currentFile.fileName}: recordsCount=${recordsCount}, totalRecords=${this.metadata.totalRecords}`
        );
    }

    /**
     * Safe write with disk space check
     */
    async safeWrite(filePath, data) {
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
            this.logger.silly?.(`[FileDatabase] Wrote ${bytesToHumanReadable(requiredBytes)} to ${filePath}`);
        } catch (error) {
            throw new FileDatabaseError(`Failed to write file ${filePath}: ${(error ).message}`);
        }
    }

    /**
     * Prepare the instance for read or write operations
     * This discovers state and sets up internal members based on mode and current data
     */
    async prepare(options









    ) {
        const { write, read, version, deferInitialVersion } = options;
        if (write) {
            if (this.versioned) {
                // Versioned mode
                if (this.currentVersion === null) {
                    if (!deferInitialVersion) {
                        await this.makeNewVersion();
                        this.metadata = this.getDefaultMetadata();
                        this.metadata.version = this.currentVersion;
                        this.makeNewFile();
                    }
                } else {
                    // For existing versions, load the metadata if not already loaded
                    if (!this.metadata.files.length) {
                        this.metadata = await this.figureMetadata(this.currentVersion);
                        // Initialize currentFileNumber from existing files
                        if (this.metadata.files && this.metadata.files.length > 0) {
                            this.currentFileNumber = Math.max(...this.metadata.files.map(f => f.number || 0));
                        } else {
                            this.currentFileNumber = 0;
                        }
                    }
                }
            } else {
                // Non-versioned mode - ensure table directory exists
                await ensurePath(this.getDestinationPath());

                // Non-versioned mode - auto-detect useMetadata if not set
                if (this.useMetadata === true) {
                    // Try to load existing metadata, create new if doesn't exist
                    const metadataPath = path.join(this.getDestinationPath(), "metadata.json");
                    if (fs.existsSync(metadataPath)) {
                        try {
                            const rawData = await fs.promises.readFile(metadataPath, "utf8");
                            this.metadata = JSON.parse(rawData);
                            // Initialize currentFileNumber from existing files
                            if (this.metadata.files && this.metadata.files.length > 0) {
                                this.currentFileNumber = Math.max(...this.metadata.files.map(f => f.number || 0));
                            } else {
                                this.currentFileNumber = 0;
                            }
                        } catch (e) {
                            this.metadata = this.getDefaultMetadata();
                            this.currentFileNumber = 0;
                        }
                    } else {
                        // Don't create a file here - let the write logic handle it
                        // This prevents creating an empty file when customMetadata is provided
                        this.metadata = this.getDefaultMetadata();
                        this.currentFileNumber = 0;
                    }
                } else {
                    // No metadata mode - just create default metadata
                    // Don't create a file here either - let the write logic handle it
                    this.metadata = this.getDefaultMetadata();
                    this.currentFileNumber = 0;
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
                    this.metadata = await this.figureMetadata(this.currentVersion);
                    // Initialize currentFileNumber from existing files
                    if (this.metadata.files && this.metadata.files.length > 0) {
                        this.currentFileNumber = Math.max(...this.metadata.files.map(f => f.number || 0));
                    } else {
                        this.currentFileNumber = 0;
                    }
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
                    const destPath = this.getDestinationPath();
                    const metadataPath = path.join(destPath, "metadata.json");
                    if (fs.existsSync(metadataPath)) {
                        try {
                            const rawData = await fs.promises.readFile(metadataPath, "utf8");
                            this.metadata = JSON.parse(rawData);
                            // Initialize currentFileNumber from existing files
                            if (this.metadata.files && this.metadata.files.length > 0) {
                                this.currentFileNumber = Math.max(...this.metadata.files.map(f => f.number || 0));
                            } else {
                                this.currentFileNumber = 0;
                            }
                        } catch (e) {
                            throw new FileDatabaseError(`Failed to read metadata: ${(e ).message}`);
                        }
                    } else {
                        throw new FileDatabaseError(
                            `[FileDatabase] No metadata found in non-versioned mode. Looked for: ${metadataPath} (table path: ${destPath})`
                        );
                    }
                } else {
                    // Figure metadata from files
                    this.metadata = await this.figureMetadataFromVersionFiles("");
                    // Initialize currentFileNumber from existing files
                    if (this.metadata.files && this.metadata.files.length > 0) {
                        this.currentFileNumber = Math.max(...this.metadata.files.map(f => f.number || 0));
                    } else {
                        this.currentFileNumber = 0;
                    }
                }
            }
        }
    }

    /**
     * Write data to the file database
     */
    async write(data, options = {}) {
        // Catalog mode: write to specific filename in destination path
        if (options.filename) {
            const destPath = this.getDestinationPath();
            await ensurePath(destPath);
            const filePath = path.join(destPath, options.filename);
            await this.safeWrite(filePath, data);
            return;
        }

        // Check for forceNewVersion in non-versioned mode
        if (options.forceNewVersion && !this.versioned) {
            throw new FileDatabaseError("Cannot use forceNewVersion in non-versioned mode");
        }

        // Prepare for writing (this may load existing metadata).
        // If this write will force a new version on an empty store, defer the initial version in
        // prepare so we only call makeNewVersion() once (in the forceNewVersion block below).
        await this.prepare({ write: true, deferInitialVersion: !!(options.forceNewVersion && this.versioned) });

        // Always detect data type from incoming data AFTER prepare()
        // This ensures we use the correct type even if existing metadata has a different type
        const incomingDataType = detectDataType(data);
        this.metadata.dataType = incomingDataType;

        // Force new version if requested (versioned mode only)
        if (options.forceNewVersion) {
            await this.makeNewVersion();
            this.metadata = this.getDefaultMetadata();
            this.metadata.version = this.currentVersion;
            // Set data type from incoming data
            this.metadata.dataType = incomingDataType;
            this.makeNewFile();
        }

        // Check if customMetadata is provided and find existing file with matching metadata
        let targetFileIndex = null;
        const hasCustomMetadata = options.customMetadata && Object.keys(options.customMetadata).length > 0;
        
        if (hasCustomMetadata) {
            // Search through existing files for matching custom metadata
            for (let i = 0; i < this.metadata.files.length; i++) {
                const fileEntry = this.metadata.files[i];
                // Check if all customMetadata fields match
                // A file matches if it has all the customMetadata keys and their values match
                const matches = Object.keys(options.customMetadata).every(key => {
                    // File must have the key and the value must match
                    return key in fileEntry && fileEntry[key] === options.customMetadata[key];
                });
                if (matches) {
                    targetFileIndex = i;
                    this.logger.silly?.(`[FileDatabase] Found existing file with matching custom metadata: ${fileEntry.fileName}, metadata: ${JSON.stringify(options.customMetadata)}`);
                    break;
                } else {
                    this.logger.silly?.(`[FileDatabase] File ${fileEntry.fileName} does not match custom metadata: ${JSON.stringify(options.customMetadata)}`);
                }
            }
            if (targetFileIndex === null) {
                this.logger.silly?.(`[FileDatabase] No existing file found with custom metadata: ${JSON.stringify(options.customMetadata)}, will create new file`);
            }
        } else {
            this.logger.silly?.(`[FileDatabase] No custom metadata provided, will create new file`);
        }

        // If we found a matching file, prepare to overwrite it
        if (targetFileIndex !== null) {
            const targetFile = this.metadata.files[targetFileIndex];
            // Set current file number to match the target file
            this.currentFileNumber = targetFile.number;
            // Reset pagination state since we're overwriting
            this.lastFileData = null;
            this.currentRecord = 0;
            this.hasReadFirstPage = false;
        }

        // Pass flag indicating if we should force a new file (when customMetadata provided but no match)
        const forceNewFile = hasCustomMetadata && targetFileIndex === null;
        // eslint-disable-next-line prefer-const
        let { dataToWrite, dataLeftOver, fileName } = this.figureOutDataAndFileToWrite(data, targetFileIndex, forceNewFile);

        // Write first batch
        const destPath = this.getDestinationPath(this.currentVersion || undefined);
        await this.safeWrite(path.join(destPath, fileName), dataToWrite);
        this.updateMetadata(dataToWrite, fileName, options.customMetadata);

        // Handle pagination for remaining data (arrays only)
        // Note: For customMetadata matches, we only write to the target file, so no pagination needed
        while (dataLeftOver && dataLeftOver.length > 0 && targetFileIndex === null) {
            const writeContext = this.figureOutDataAndFileToWrite(dataLeftOver);
            await this.safeWrite(path.join(destPath, writeContext.fileName), writeContext.dataToWrite);
            this.updateMetadata(writeContext.dataToWrite, writeContext.fileName, options.customMetadata);
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
    async read(options = {}) {
        const { version, nextPage = false, pageSize, filename } = options;

        // Catalog mode: read specific file by name
        if (filename) {
            const destPath = this.getDestinationPath(version);
            const filePath = path.join(destPath, filename);
            try {
                const rawData = await fs.promises.readFile(filePath, "utf8");
                return JSON.parse(rawData);
            } catch (error) {
                throw new FileDatabaseError(`Failed to read file ${filename}: ${(error ).message}`);
            }
        }

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
                return deserializeData(rawData, this.metadata.dataType);
            } catch (error) {
                throw new FileDatabaseError(`Failed to read file ${file.fileName}: ${(error ).message}`);
            }
        }

        // Handle paginated data (JSON arrays)
        let effectivePageSize;

        if (nextPage && this.hasReadFirstPage) {
            // currentRecord was already advanced by records actually returned
            // at the end of the previous read (not by requested pageSize — that
            // skipped records when a read ended mid-file / short final page).
            effectivePageSize = pageSize || this.pageSize;
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

        const result = [];
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

        // Read from files (cache parsed JSON — harvest chunks are often 50–60MB;
        // re-parsing on every nextPage with pageSize=200 is catastrophic).
        let cumulativeRecords = currentFileOffset;
        for (let i = currentFileIndex; i < this.metadata.files.length && recordsRead < effectivePageSize; i++) {
            const file = this.metadata.files[i];
            const filePath = path.join(this.getDestinationPath(this.currentVersion || undefined), file.fileName);

            try {
                let fileData;
                if (this.readFileCache?.filePath === filePath && Array.isArray(this.readFileCache.data)) {
                    fileData = this.readFileCache.data;
                } else {
                    const rawData = await fs.promises.readFile(filePath, "utf8");
                    fileData = deserializeData(rawData, this.metadata.dataType);
                    this.readFileCache = { filePath, data: fileData };
                }

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
                throw new FileDatabaseError(`Failed to read file ${file.fileName}: ${(error ).message}`);
            }
        }

        // Advance by what we actually returned so mid-file seeks + short pages
        // don't skip records on the next nextPage call.
        this.currentRecord += recordsRead;

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
    setStartRecord(startRecord) {
        this.currentRecord = startRecord - 1;
        this.hasReadFirstPage = false;
        this.readFileCache = null;
    }

    /**
     * Reset read pagination state
     */
    resetPagination() {
        this.currentRecord = 0;
        this.hasReadFirstPage = false;
        this.readFileCache = null;
    }

    /**
     * List filenames in the table directory.
     * For catalog/key-value usage (files written with { filename }).
     * Returns data file names (.json, .txt, .xml) excluding metadata.json.
     */
    async listFilenames() {
        const destPath = this.versioned && this.currentVersion
            ? path.join(this.getDestinationPath(), this.currentVersion)
            : this.getDestinationPath();
        try {
            const entries = await fs.promises.readdir(destPath, { withFileTypes: true });
            return entries
                .filter((e) => e.isFile() && e.name !== "metadata.json" && /\.(json|txt|xml)$/i.test(e.name))
                .map((e) => e.name);
        } catch (err) {
            if (err?.code === "ENOENT") return [];
            throw new FileDatabaseError(`Failed to list files: ${(err ).message}`);
        }
    }

    /**
     * Remove a file from the table directory (catalog mode).
     * Use with listFilenames() to manage individual files.
     */
    async removeFile(filename) {
        const destPath = this.versioned && this.currentVersion
            ? path.join(this.getDestinationPath(), this.currentVersion)
            : this.getDestinationPath();
        const filePath = path.join(destPath, filename);
        try {
            await fs.promises.unlink(filePath);
        } catch (err) {
            if (err?.code === "ENOENT") return;
            throw new FileDatabaseError(`Failed to remove file ${filename}: ${(err ).message}`);
        }
    }

    /**
     * Remove a file and its metadata entry (non-versioned mode with useMetadata).
     * Use with findData() to get fileName, then call removeFileEntry to delete.
     */
    async removeFileEntry(filename) {
        if (this.versioned) {
            throw new FileDatabaseError("removeFileEntry is only supported in non-versioned mode");
        }
        await this.prepare({ read: true });
        const idx = this.metadata.files.findIndex((f) => f.fileName === filename);
        if (idx === -1) {
            throw new FileDatabaseError(`File entry ${filename} not found in metadata`);
        }
        const entry = this.metadata.files[idx];
        const recordsCount = entry.recordsCount || 0;
        this.metadata.files.splice(idx, 1);
        this.metadata.totalRecords = Math.max(0, (this.metadata.totalRecords || 0) - recordsCount);
        const destPath = this.getDestinationPath();
        const filePath = path.join(destPath, filename);
        try {
            await fs.promises.unlink(filePath);
        } catch (err) {
            if (err?.code === "ENOENT") {
                this.logger.warn?.(`[FileDatabase] File ${filename} already missing on disk`);
            } else {
                throw new FileDatabaseError(`Failed to remove file ${filename}: ${(err ).message}`);
            }
        }
        if (this.useMetadata) {
            await this.saveVersionMetadata(this.metadata);
        }
    }

    /**
     * Set file-level synopsis calculation function
     */
    setFileSynopsisFunction(fn) {
        this.fileSynopsisFunction = fn;
    }

    /**
     * Set version-level synopsis calculation function
     */
    setVersionSynopsisFunction(fn) {
        this.versionSynopsisFunction = fn;
    }

    /**
     * Get current version name
     */
    getCurrentVersion() {
        return this.currentVersion;
    }

    /**
     * Max retained version folders (used by harvest_sync.loaded_versions cap, etc.).
     */
    getMaxVersions() {
        return this.maxVersions;
    }

    /**
     * Get current metadata
     */
    getMetadata() {
        return { ...this.metadata };
    }

    /**
     * Find data by custom metadata fields
     * Searches through all versions and files to find entries matching the search criteria
     * 
     * @param searchCriteria - Object with field names and values to search for (e.g., { ListingKey: "123", id: "456" })
     * @returns Array of found entries with their file paths and metadata
     */
    async findData(searchCriteria)





    {
        const results





 = [];

        // Handle non-versioned mode separately
        if (!this.versioned) {
            // Load metadata for non-versioned mode
            await this.prepare({ read: true });
            const metadata = this.getMetadata();
            
            // Search through files
            for (const fileEntry of metadata.files) {
                // Check if file entry matches search criteria
                const matches = Object.keys(searchCriteria).every(key => {
                    return fileEntry[key] === searchCriteria[key];
                });

                if (matches) {
                    // Read the file data
                    const destPath = this.getDestinationPath();
                    const filePath = path.join(destPath, fileEntry.fileName);
                    const fileData = await fs.promises.readFile(filePath, "utf8");
                    const data = deserializeData(fileData, metadata.dataType || "json-object");

                    results.push({
                        filePath,
                        fileName: fileEntry.fileName,
                        version: null,
                        metadata: fileEntry,
                        data,
                    });
                }
            }
        } else {
            // Versioned mode: search through all versions
            const versions = await this.getVersions();
            
            for (const version of versions) {
                // Load metadata for this version
                await this.prepare({ read: true, version });
                const metadata = this.getMetadata();

                // Search through files in this version
                for (const fileEntry of metadata.files) {
                    // Check if file entry matches search criteria
                    const matches = Object.keys(searchCriteria).every(key => {
                        return fileEntry[key] === searchCriteria[key];
                    });

                    if (matches) {
                        // Read the file data
                        const destPath = this.getDestinationPath(version);
                        const filePath = path.join(destPath, fileEntry.fileName);
                        const fileData = await fs.promises.readFile(filePath, "utf8");
                        const data = deserializeData(fileData, metadata.dataType || "json-object");

                        results.push({
                            filePath,
                            fileName: fileEntry.fileName,
                            version,
                            metadata: fileEntry,
                            data,
                        });
                    }
                }
            }
        }

        return results;
    }
}

// Export types











;

// Export synopsis functions
export { defaultFileSynopsisFunction, defaultVersionSynopsisFunction } from "./synopsis-functions.js";

/**
 * Initialize FileDatabase from context
 * Similar to MlsClient.init pattern
 * 
 * @param context - Context from init()
 * @param options - Optional configuration (takes precedence over context.params)
 * @returns Initialized FileDatabase instance
 */
/**
 * List all table names in a given namespace
 * Scans the filesystem to find all table directories
 *
 * @param basePath - Base path for file storage
 * @param namespace - Namespace to scan (e.g., "harvested", "fromMLS")
 * @returns Array of table names (directory names)
 */
export function listTables(basePath, namespace) {
    const namespacePath = path.join(basePath, namespace);

    if (!fs.existsSync(namespacePath)) {
        return [];
    }

    try {
        return fs.readdirSync(namespacePath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
    } catch (error) {
        // Return empty array if can't read directory
        return [];
    }
}

/**
 * List all sources (namespaces) in a given base path
 * Scans the filesystem to find all namespace directories
 *
 * @param basePath - Base path for file storage
 * @returns Array of source names (directory names)
 */
export function listSources(basePath) {
    if (!fs.existsSync(basePath)) {
        return [];
    }

    try {
        return fs.readdirSync(basePath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
    } catch (error) {
        // Return empty array if can't read directory
        return [];
    }
}
