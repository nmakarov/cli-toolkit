/**
 * Synopsis Functions - Predefined synopsis calculations for FileDatabase
 * 
 * These functions analyze file and version data to generate useful summaries
 * and statistics that can be stored in metadata.
 */

import type { FileEntry, VersionMetadata } from "./types.js";

/**
 * Default file-level synopsis function
 * Extracts min/max ModificationTimestamp and StandardStatus counts from records
 */
export function defaultFileSynopsisFunction(fileEntry: FileEntry, data: any): FileEntry {
    if (!Array.isArray(data) || data.length === 0) {
        return { ...fileEntry };
    }

    const timestamps: number[] = [];
    const statusCounts: Record<string, number> = {};

    for (const item of data) {
        let ts: number | null = null;
        let status: string | null = null;

        for (const [key, value] of Object.entries(item)) {
            const k = key.toLowerCase();
            if (k === "modificationtimestamp") {
                ts = new Date(value as string).getTime();
            }
            if (k === "standardstatus") {
                status = value as string;
            }
        }

        if (ts && !isNaN(ts)) {
            timestamps.push(ts);
        }

        if (status !== null && status !== undefined) {
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
    }

    const result: FileEntry = { ...fileEntry };

    if (timestamps.length) {
        result.minModificationTimestamp = new Date(Math.min(...timestamps)).toISOString();
        result.maxModificationTimestamp = new Date(Math.max(...timestamps)).toISOString();
    }

    if (Object.keys(statusCounts).length) {
        result.StandardStatuses = statusCounts;
    }

    return result;
}

/**
 * Default version-level synopsis function
 * Aggregates min/max timestamps and status counts across all files in a version
 */
export function defaultVersionSynopsisFunction(metadata: VersionMetadata): VersionMetadata {
    if (!metadata?.files || !Array.isArray(metadata.files)) {
        return metadata;
    }

    const timestamps: number[] = [];
    const statusCounts: Record<string, number> = {};

    for (const file of metadata.files) {
        // Collect timestamps
        if ((file as any).minModificationTimestamp) {
            const minTs = new Date((file as any).minModificationTimestamp).getTime();
            if (!isNaN(minTs)) timestamps.push(minTs);
        }
        if ((file as any).maxModificationTimestamp) {
            const maxTs = new Date((file as any).maxModificationTimestamp).getTime();
            if (!isNaN(maxTs)) timestamps.push(maxTs);
        }

        // Aggregate statuses
        if ((file as any).StandardStatuses && typeof (file as any).StandardStatuses === "object") {
            for (const [status, count] of Object.entries((file as any).StandardStatuses)) {
                statusCounts[status] = (statusCounts[status] || 0) + (count as number);
            }
        }
    }

    const result = { ...metadata };

    if (timestamps.length) {
        (result as any).minModificationTimestamp = new Date(Math.min(...timestamps)).toISOString();
        (result as any).maxModificationTimestamp = new Date(Math.max(...timestamps)).toISOString();
    }

    if (Object.keys(statusCounts).length > 0) {
        (result as any).StandardStatuses = statusCounts;
    }

    return result;
}

