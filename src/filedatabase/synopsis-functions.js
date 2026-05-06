








/**
 * Default file-level synopsis function
 * Extracts min/max ModificationTimestamp and StandardStatus counts from records
 */
export function defaultFileSynopsisFunction(fileEntry, data) {
    if (!Array.isArray(data) || data.length === 0) {
        return { ...fileEntry };
    }

    const timestamps = [];
    const statusCounts = {};

    for (const item of data) {
        let ts = null;
        let status = null;

        for (const [key, value] of Object.entries(item)) {
            const k = key.toLowerCase();
            if (k === "modificationtimestamp") {
                ts = new Date(value ).getTime();
            }
            if (k === "standardstatus") {
                status = value ;
            }
        }

        if (ts && !isNaN(ts)) {
            timestamps.push(ts);
        }

        if (status !== null && status !== undefined) {
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
    }

    const result = { ...fileEntry };

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
export function defaultVersionSynopsisFunction(metadata) {
    if (!metadata?.files || !Array.isArray(metadata.files)) {
        return metadata;
    }

    const timestamps = [];
    const statusCounts = {};

    for (const file of metadata.files) {
        // Collect timestamps
        if ((file ).minModificationTimestamp) {
            const minTs = new Date((file ).minModificationTimestamp).getTime();
            if (!isNaN(minTs)) timestamps.push(minTs);
        }
        if ((file ).maxModificationTimestamp) {
            const maxTs = new Date((file ).maxModificationTimestamp).getTime();
            if (!isNaN(maxTs)) timestamps.push(maxTs);
        }

        // Aggregate statuses
        if ((file ).StandardStatuses && typeof (file ).StandardStatuses === "object") {
            for (const [status, count] of Object.entries((file ).StandardStatuses)) {
                statusCounts[status] = (statusCounts[status] || 0) + (count );
            }
        }
    }

    const result = { ...metadata };

    if (timestamps.length) {
        (result ).minModificationTimestamp = new Date(Math.min(...timestamps)).toISOString();
        (result ).maxModificationTimestamp = new Date(Math.max(...timestamps)).toISOString();
    }

    if (Object.keys(statusCounts).length > 0) {
        (result ).StandardStatuses = statusCounts;
    }

    return result;
}

