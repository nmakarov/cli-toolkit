/**
 * Legacy MLS-oriented synopsis helpers.
 *
 * @deprecated MLS harvest digests (ModificationTimestamp min/max + StandardStatus
 * counts) live in mlsfarm `v2/mls-toolkit/src/harvest/synopsis.js`
 * (`attachHarvestSynopsis`). FileDatabase stays domain-agnostic — attach a
 * synopsis plugin from the app layer. These exports remain for older callers /
 * tests; prefer mls-toolkit for new harvest code.
 */

/**
 * Default file-level synopsis function
 * Extracts min/max *ModificationTimestamp and StandardStatus counts from records.
 * Matches ModificationTimestamp and MediaModificationTimestamp (any key ending
 * with "modificationtimestamp", case-insensitive).
 */
export function defaultFileSynopsisFunction(fileEntry, data) {
    if (!Array.isArray(data) || data.length === 0) {
        return { ...fileEntry };
    }

    const timestamps = [];
    const statusCounts = {};

    for (const item of data) {
        if (!item || typeof item !== "object") continue;

        for (const [key, value] of Object.entries(item)) {
            const k = key.toLowerCase();
            if (k.endsWith("modificationtimestamp") && value != null && value !== "") {
                const ts = new Date(value).getTime();
                if (!Number.isNaN(ts)) timestamps.push(ts);
            }
            if (k === "standardstatus" && value != null && value !== "") {
                const status = String(value);
                statusCounts[status] = (statusCounts[status] || 0) + 1;
            }
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
        if (file?.minModificationTimestamp) {
            const minTs = new Date(file.minModificationTimestamp).getTime();
            if (!Number.isNaN(minTs)) timestamps.push(minTs);
        }
        if (file?.maxModificationTimestamp) {
            const maxTs = new Date(file.maxModificationTimestamp).getTime();
            if (!Number.isNaN(maxTs)) timestamps.push(maxTs);
        }

        if (file?.StandardStatuses && typeof file.StandardStatuses === "object") {
            for (const [status, count] of Object.entries(file.StandardStatuses)) {
                statusCounts[status] = (statusCounts[status] || 0) + Number(count || 0);
            }
        }
    }

    const result = { ...metadata };
    const synopsis = {
        ...(metadata.synopsis && typeof metadata.synopsis === "object" ? metadata.synopsis : {}),
    };

    if (timestamps.length) {
        const minIso = new Date(Math.min(...timestamps)).toISOString();
        const maxIso = new Date(Math.max(...timestamps)).toISOString();
        result.minModificationTimestamp = minIso;
        result.maxModificationTimestamp = maxIso;
        synopsis.minModificationTimestamp = minIso;
        synopsis.maxModificationTimestamp = maxIso;
    }

    if (Object.keys(statusCounts).length > 0) {
        result.StandardStatuses = statusCounts;
        synopsis.StandardStatuses = statusCounts;
    }

    if (Object.keys(synopsis).length) {
        result.synopsis = synopsis;
    }
    return result;
}
