import { describe, it, expect } from "vitest";
import { defaultFileSynopsisFunction, defaultVersionSynopsisFunction } from "../synopsis-functions.js";
import type { FileEntry, VersionMetadata } from "../types.js";

describe("Synopsis Functions CI", () => {
    describe("defaultFileSynopsisFunction", () => {
        it("returns unchanged fileEntry for empty array", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 0,
                startRecord: 0,
                endRecord: 0,
                size: 0,
            };

            const result = defaultFileSynopsisFunction(fileEntry, []);
            expect(result).toEqual(fileEntry);
        });

        it("returns unchanged fileEntry for non-array data", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 1,
                startRecord: 0,
                endRecord: 0,
                size: 100,
            };

            const result = defaultFileSynopsisFunction(fileEntry, { key: "value" });
            expect(result).toEqual(fileEntry);
        });

        it("extracts min and max ModificationTimestamp from data", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 3,
                startRecord: 0,
                endRecord: 2,
                size: 300,
            };

            const data = [
                { id: 1, ModificationTimestamp: "2025-01-01T10:00:00Z" },
                { id: 2, ModificationTimestamp: "2025-01-01T12:00:00Z" },
                { id: 3, ModificationTimestamp: "2025-01-01T08:00:00Z" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result.minModificationTimestamp).toBe("2025-01-01T08:00:00.000Z");
            expect(result.maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
        });

        it("handles case-insensitive ModificationTimestamp field names", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 2,
                startRecord: 0,
                endRecord: 1,
                size: 200,
            };

            const data = [
                { id: 1, modificationtimestamp: "2025-01-01T10:00:00Z" },
                { id: 2, MODIFICATIONTIMESTAMP: "2025-01-01T12:00:00Z" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result.minModificationTimestamp).toBe("2025-01-01T10:00:00.000Z");
            expect(result.maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
        });

        it("counts StandardStatus occurrences", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 5,
                startRecord: 0,
                endRecord: 4,
                size: 500,
            };

            const data = [
                { id: 1, StandardStatus: "Active" },
                { id: 2, StandardStatus: "Active" },
                { id: 3, StandardStatus: "Pending" },
                { id: 4, StandardStatus: "Active" },
                { id: 5, StandardStatus: "Closed" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result.StandardStatuses).toEqual({
                Active: 3,
                Pending: 1,
                Closed: 1,
            });
        });

        it("handles case-insensitive StandardStatus field names", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 3,
                startRecord: 0,
                endRecord: 2,
                size: 300,
            };

            const data = [
                { id: 1, standardstatus: "Active" },
                { id: 2, STANDARDSTATUS: "Active" },
                { id: 3, StandardStatus: "Pending" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result.StandardStatuses).toEqual({
                Active: 2,
                Pending: 1,
            });
        });

        it("handles data with both ModificationTimestamp and StandardStatus", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 3,
                startRecord: 0,
                endRecord: 2,
                size: 300,
            };

            const data = [
                { id: 1, ModificationTimestamp: "2025-01-01T10:00:00Z", StandardStatus: "Active" },
                { id: 2, ModificationTimestamp: "2025-01-01T12:00:00Z", StandardStatus: "Active" },
                { id: 3, ModificationTimestamp: "2025-01-01T08:00:00Z", StandardStatus: "Pending" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result.minModificationTimestamp).toBe("2025-01-01T08:00:00.000Z");
            expect(result.maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
            expect(result.StandardStatuses).toEqual({
                Active: 2,
                Pending: 1,
            });
        });

        it("skips invalid timestamps", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 3,
                startRecord: 0,
                endRecord: 2,
                size: 300,
            };

            const data = [
                { id: 1, ModificationTimestamp: "2025-01-01T10:00:00Z" },
                { id: 2, ModificationTimestamp: "invalid-date" },
                { id: 3, ModificationTimestamp: "2025-01-01T12:00:00Z" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result.minModificationTimestamp).toBe("2025-01-01T10:00:00.000Z");
            expect(result.maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
        });

        it("handles records with missing ModificationTimestamp", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 3,
                startRecord: 0,
                endRecord: 2,
                size: 300,
            };

            const data = [
                { id: 1, ModificationTimestamp: "2025-01-01T10:00:00Z" },
                { id: 2, name: "No timestamp" },
                { id: 3, ModificationTimestamp: "2025-01-01T12:00:00Z" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result.minModificationTimestamp).toBe("2025-01-01T10:00:00.000Z");
            expect(result.maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
        });

        it("handles records with missing StandardStatus", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 3,
                startRecord: 0,
                endRecord: 2,
                size: 300,
            };

            const data = [
                { id: 1, StandardStatus: "Active" },
                { id: 2, name: "No status" },
                { id: 3, StandardStatus: "Pending" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result.StandardStatuses).toEqual({
                Active: 1,
                Pending: 1,
            });
        });

        it("does not add synopsis fields when no relevant data found", () => {
            const fileEntry: FileEntry = {
                fileName: "000001.json",
                recordsCount: 2,
                startRecord: 0,
                endRecord: 1,
                size: 200,
            };

            const data = [
                { id: 1, name: "Item 1" },
                { id: 2, name: "Item 2" },
            ];

            const result = defaultFileSynopsisFunction(fileEntry, data);

            expect(result).toEqual(fileEntry);
            expect(result.minModificationTimestamp).toBeUndefined();
            expect(result.maxModificationTimestamp).toBeUndefined();
            expect(result.StandardStatuses).toBeUndefined();
        });
    });

    describe("defaultVersionSynopsisFunction", () => {
        it("returns unchanged metadata when files array is missing", () => {
            const metadata = {
                version: "2025-01-01T00:00:00Z",
                totalRecords: 0,
                dataType: "json-array",
                files: [],
            } as VersionMetadata;

            const result = defaultVersionSynopsisFunction(metadata);
            expect(result).toEqual(metadata);
        });

        it("returns unchanged metadata when files array is empty", () => {
            const metadata = {
                version: "2025-01-01T00:00:00Z",
                totalRecords: 0,
                dataType: "json-array",
                files: [],
            } as VersionMetadata;

            const result = defaultVersionSynopsisFunction(metadata);
            expect(result).toEqual(metadata);
        });

        it("aggregates min and max timestamps from file-level synopsis", () => {
            const metadata = {
                version: "2025-01-01T00:00:00Z",
                totalRecords: 300,
                dataType: "json-array",
                files: [
                    {
                        fileName: "000001.json",
                        recordsCount: 100,
                        startRecord: 0,
                        endRecord: 99,
                        size: 1000,
                        minModificationTimestamp: "2025-01-01T08:00:00.000Z",
                        maxModificationTimestamp: "2025-01-01T10:00:00.000Z",
                    },
                    {
                        fileName: "000002.json",
                        recordsCount: 100,
                        startRecord: 100,
                        endRecord: 199,
                        size: 1000,
                        minModificationTimestamp: "2025-01-01T06:00:00.000Z",
                        maxModificationTimestamp: "2025-01-01T12:00:00.000Z",
                    },
                    {
                        fileName: "000003.json",
                        recordsCount: 100,
                        startRecord: 200,
                        endRecord: 299,
                        size: 1000,
                        minModificationTimestamp: "2025-01-01T07:00:00.000Z",
                        maxModificationTimestamp: "2025-01-01T11:00:00.000Z",
                    },
                ],
            } as VersionMetadata;

            const result = defaultVersionSynopsisFunction(metadata);

            expect((result as any).minModificationTimestamp).toBe("2025-01-01T06:00:00.000Z");
            expect((result as any).maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
        });

        it("aggregates StandardStatus counts from file-level synopsis", () => {
            const metadata = {
                version: "2025-01-01T00:00:00Z",
                totalRecords: 200,
                dataType: "json-array",
                files: [
                    {
                        fileName: "000001.json",
                        recordsCount: 100,
                        startRecord: 0,
                        endRecord: 99,
                        size: 1000,
                        StandardStatuses: { Active: 60, Pending: 40 },
                    },
                    {
                        fileName: "000002.json",
                        recordsCount: 100,
                        startRecord: 100,
                        endRecord: 199,
                        size: 1000,
                        StandardStatuses: { Active: 50, Closed: 30, Pending: 20 },
                    },
                ],
            } as VersionMetadata;

            const result = defaultVersionSynopsisFunction(metadata);

            expect((result as any).StandardStatuses).toEqual({
                Active: 110,
                Pending: 60,
                Closed: 30,
            });
        });

        it("combines timestamps and status counts", () => {
            const metadata = {
                version: "2025-01-01T00:00:00Z",
                totalRecords: 200,
                dataType: "json-array",
                files: [
                    {
                        fileName: "000001.json",
                        recordsCount: 100,
                        startRecord: 0,
                        endRecord: 99,
                        size: 1000,
                        minModificationTimestamp: "2025-01-01T08:00:00.000Z",
                        maxModificationTimestamp: "2025-01-01T10:00:00.000Z",
                        StandardStatuses: { Active: 60, Pending: 40 },
                    },
                    {
                        fileName: "000002.json",
                        recordsCount: 100,
                        startRecord: 100,
                        endRecord: 199,
                        size: 1000,
                        minModificationTimestamp: "2025-01-01T06:00:00.000Z",
                        maxModificationTimestamp: "2025-01-01T12:00:00.000Z",
                        StandardStatuses: { Active: 50, Closed: 30 },
                    },
                ],
            } as VersionMetadata;

            const result = defaultVersionSynopsisFunction(metadata);

            expect((result as any).minModificationTimestamp).toBe("2025-01-01T06:00:00.000Z");
            expect((result as any).maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
            expect((result as any).StandardStatuses).toEqual({
                Active: 110,
                Pending: 40,
                Closed: 30,
            });
        });

        it("handles files without synopsis data", () => {
            const metadata = {
                version: "2025-01-01T00:00:00Z",
                totalRecords: 200,
                dataType: "json-array",
                files: [
                    {
                        fileName: "000001.json",
                        recordsCount: 100,
                        startRecord: 0,
                        endRecord: 99,
                        size: 1000,
                    },
                    {
                        fileName: "000002.json",
                        recordsCount: 100,
                        startRecord: 100,
                        endRecord: 199,
                        size: 1000,
                    },
                ],
            } as VersionMetadata;

            const result = defaultVersionSynopsisFunction(metadata);

            expect((result as any).minModificationTimestamp).toBeUndefined();
            expect((result as any).maxModificationTimestamp).toBeUndefined();
            expect((result as any).StandardStatuses).toBeUndefined();
        });

        it("handles mixed files with and without synopsis data", () => {
            const metadata = {
                version: "2025-01-01T00:00:00Z",
                totalRecords: 300,
                dataType: "json-array",
                files: [
                    {
                        fileName: "000001.json",
                        recordsCount: 100,
                        startRecord: 0,
                        endRecord: 99,
                        size: 1000,
                        minModificationTimestamp: "2025-01-01T08:00:00.000Z",
                        maxModificationTimestamp: "2025-01-01T10:00:00.000Z",
                        StandardStatuses: { Active: 60 },
                    },
                    {
                        fileName: "000002.json",
                        recordsCount: 100,
                        startRecord: 100,
                        endRecord: 199,
                        size: 1000,
                        // No synopsis data
                    },
                    {
                        fileName: "000003.json",
                        recordsCount: 100,
                        startRecord: 200,
                        endRecord: 299,
                        size: 1000,
                        minModificationTimestamp: "2025-01-01T06:00:00.000Z",
                        maxModificationTimestamp: "2025-01-01T12:00:00.000Z",
                        StandardStatuses: { Active: 40, Pending: 60 },
                    },
                ],
            } as VersionMetadata;

            const result = defaultVersionSynopsisFunction(metadata);

            expect((result as any).minModificationTimestamp).toBe("2025-01-01T06:00:00.000Z");
            expect((result as any).maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
            expect((result as any).StandardStatuses).toEqual({
                Active: 100,
                Pending: 60,
            });
        });

        it("skips invalid timestamps in aggregation", () => {
            const metadata = {
                version: "2025-01-01T00:00:00Z",
                totalRecords: 200,
                dataType: "json-array",
                files: [
                    {
                        fileName: "000001.json",
                        recordsCount: 100,
                        startRecord: 0,
                        endRecord: 99,
                        size: 1000,
                        minModificationTimestamp: "invalid-date",
                        maxModificationTimestamp: "2025-01-01T10:00:00.000Z",
                    },
                    {
                        fileName: "000002.json",
                        recordsCount: 100,
                        startRecord: 100,
                        endRecord: 199,
                        size: 1000,
                        minModificationTimestamp: "2025-01-01T06:00:00.000Z",
                        maxModificationTimestamp: "2025-01-01T12:00:00.000Z",
                    },
                ],
            } as VersionMetadata;

            const result = defaultVersionSynopsisFunction(metadata);

            expect((result as any).minModificationTimestamp).toBe("2025-01-01T06:00:00.000Z");
            expect((result as any).maxModificationTimestamp).toBe("2025-01-01T12:00:00.000Z");
        });
    });
});

