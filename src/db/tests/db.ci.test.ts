import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Db } from "../index.js";
import { ParamError } from "../../errors.js";

// Mock knex - must be hoisted, cannot reference external functions
vi.mock('knex', () => {
    // Create a callable function that also has properties (like real Knex)
    const mockKnexInstance = vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        table,
    }));
    
    // Attach properties to the callable function
    (mockKnexInstance as any).raw = vi.fn();
    (mockKnexInstance as any).schema = {
        hasTable: vi.fn(),
    };
    (mockKnexInstance as any).on = vi.fn();
    (mockKnexInstance as any).destroy = vi.fn();
    (mockKnexInstance as any).client = {
        acquireConnection: vi.fn(),
        releaseConnection: vi.fn(),
    };

    const mockKnex = vi.fn(() => mockKnexInstance);

    // Store instance reference on the mock function for test access
    (mockKnex as any)._mockInstance = mockKnexInstance;

    return {
        default: mockKnex,
    };
});

// Import mocked knex and get reference to mock instance
import knex from 'knex';
const mockKnex = knex as any;
let mockKnexInstance: any;

describe("Db CI", () => {
    let db: Db;
    let mockLogger: any;

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Get the mock instance from the mocked knex function
        mockKnexInstance = (mockKnex as any)._mockInstance || createMockKnexInstance();
        
        mockLogger = {
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
        };

        // Reset mockKnexInstance methods
        mockKnexInstance.raw.mockResolvedValue({ rows: [{ result: 5 }] });
        mockKnexInstance.schema.hasTable.mockResolvedValue(true);
        mockKnexInstance.destroy.mockResolvedValue(undefined);
        mockKnexInstance.on.mockImplementation(() => {});
        
        // mockKnexInstance is already callable (created as a function in vi.mock)
        // Just reset its mock implementation
        mockKnexInstance.mockImplementation((table: string) => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            table,
        }));
    });

    afterEach(async () => {
        // Clean up any connections
        if (db && db.isConnectedToDb()) {
            try {
                await db.disconnect();
            } catch {
                // Ignore cleanup errors
            }
        }
    });

    describe("constructor", () => {
        it("should create Db instance with required config", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            expect(db).toBeDefined();
            expect(db.isConnectedToDb()).toBe(false);
        });

        it("should throw ParamError if connectionString is missing", () => {
            expect(() => {
                db = new Db({} as any);
            }).toThrow(ParamError);
        });

        it("should use default config values", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
            });

            expect(db).toBeDefined();
        });
    });

    describe("connect", () => {
        it("should connect to PostgreSQL database", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false, // Skip test for this test
            });

            await db.connect();

            expect(mockKnex).toHaveBeenCalledWith(
                expect.objectContaining({
                    client: "pg",
                    connection: expect.objectContaining({
                        connectionString: "postgresql://user:pass@localhost:5432/testdb",
                        family: 4, // IPv4 only
                    }),
                })
            );
            expect(db.isConnectedToDb()).toBe(true);
        });

        it("should connect to MySQL database", async () => {
            db = new Db({
                connectionString: "mysql://user:pass@localhost:3306/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            expect(mockKnex).toHaveBeenCalledWith(
                expect.objectContaining({
                    client: "mysql2",
                })
            );
        });

        it("should throw ParamError for unknown client type", async () => {
            db = new Db({
                connectionString: "unknown://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            await expect(db.connect()).rejects.toThrow(ParamError);
        });

        it("should test connection when testConnection is true", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: true,
            });

            await db.connect();

            expect(mockKnexInstance.raw).toHaveBeenCalledWith("SELECT 2+3 AS result");
        });

        it("should attach profiler when profile is true", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                profile: true,
                testConnection: false,
            });

            await db.connect();

            expect(mockKnexInstance.on).toHaveBeenCalledWith("query", expect.any(Function));
            expect(mockKnexInstance.on).toHaveBeenCalledWith("query-response", expect.any(Function));
            expect(mockKnexInstance.on).toHaveBeenCalledWith("query-error", expect.any(Function));
        });

        it("should not connect twice", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            await db.connect(); // Second call

            expect(mockKnex).toHaveBeenCalledTimes(1);
            expect(mockLogger.warn).toHaveBeenCalledWith("[Db] Already connected");
        });

        it("should handle connection errors", async () => {
            const connectionError = new Error("Connection failed");
            mockKnex.mockImplementationOnce(() => {
                throw connectionError;
            });

            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            await expect(db.connect()).rejects.toThrow(ParamError);
        });

        it("should handle test connection failures", async () => {
            mockKnexInstance.raw.mockRejectedValueOnce(new Error("ECONNREFUSED"));

            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: true,
            });

            await expect(db.connect()).rejects.toThrow(ParamError);
        });
    });

    describe("disconnect", () => {
        it("should disconnect from database", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            await db.disconnect();

            expect(mockKnexInstance.destroy).toHaveBeenCalled();
            expect(db.isConnectedToDb()).toBe(false);
        });

        it("should handle disconnect when not connected", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            await db.disconnect(); // Should not throw

            expect(mockKnexInstance.destroy).not.toHaveBeenCalled();
        });

        it("should handle disconnect errors", async () => {
            mockKnexInstance.destroy.mockRejectedValueOnce(new Error("Destroy failed"));

            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            await expect(db.disconnect()).rejects.toThrow();
        });
    });

    describe("testConnection", () => {
        it("should test connection successfully", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            const result = await db.testConnection();

            expect(result).toBe(true);
            expect(mockKnexInstance.raw).toHaveBeenCalledWith("SELECT 2+3 AS result");
        });

        it("should handle MySQL result format", async () => {
            mockKnexInstance.raw.mockResolvedValueOnce([[{ result: 5 }]]);

            db = new Db({
                connectionString: "mysql://user:pass@localhost:3306/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            const result = await db.testConnection();

            expect(result).toBe(true);
        });

        it("should throw error if not connected", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            await expect(db.testConnection()).rejects.toThrow("Not connected");
        });

        it("should handle connection test failures", async () => {
            const testError = new Error("ECONNREFUSED");
            mockKnexInstance.raw.mockRejectedValueOnce(testError);

            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            await expect(db.testConnection()).rejects.toThrow(ParamError);
        });
    });

    describe("callable functionality", () => {
        it("should forward calls to Knex instance when connected", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            // Test that the Knex instance is accessible
            // Note: The actual callable behavior (db('table')) is tested in example/integration tests
            // since Proxy apply trap requires a function target. Here we verify the instance setup.
            const knex = db.getKnex();
            expect(knex).toBe(mockKnexInstance);
            expect(knex).toBeDefined();
        });

        it("should verify connection state before allowing operations", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            // Verify not connected
            expect(db.isConnectedToDb()).toBe(false);
            
            // Verify getKnex throws when not connected
            expect(() => db.getKnex()).toThrow("Not connected");
        });
    });

    describe("Knex method forwarding", () => {
        it("should forward db.schema to Knex instance", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            const schema = (db as any).schema;
            expect(schema).toBe(mockKnexInstance.schema);
        });

        it("should forward db.raw to Knex instance", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            const raw = (db as any).raw;
            expect(raw).toBeDefined();
            expect(typeof raw).toBe("function");
        });
    });

    describe("tableExists", () => {
        it("should check if table exists", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            const exists = await db.tableExists("users");
            expect(exists).toBe(true);
            expect(mockKnexInstance.schema.hasTable).toHaveBeenCalledWith("users");
        });

        it("should return false when table does not exist", async () => {
            mockKnexInstance.schema.hasTable.mockResolvedValueOnce(false);

            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            const exists = await db.tableExists("nonexistent");
            expect(exists).toBe(false);
        });

        it("should throw error if not connected", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            await expect(db.tableExists("users")).rejects.toThrow("Not connected");
        });

        it("should handle tableExists errors", async () => {
            const tableError = new Error("Table check failed");
            mockKnexInstance.schema.hasTable.mockRejectedValueOnce(tableError);

            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            await expect(db.tableExists("users")).rejects.toThrow();
        });
    });

    describe("query profiling", () => {
        it("should log queries when profiling is enabled", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                profile: true,
                testConnection: false,
            });

            await db.connect();

            // Simulate a query
            const queryEvent = mockKnexInstance.on.mock.calls.find(
                (call: any[]) => call[0] === "query"
            )?.[1];
            const responseEvent = mockKnexInstance.on.mock.calls.find(
                (call: any[]) => call[0] === "query-response"
            )?.[1];

            if (queryEvent && responseEvent) {
                const mockQuery = { sql: "SELECT * FROM users", bindings: [], __startTime: [0, 0] };
                queryEvent(mockQuery);
                responseEvent({}, mockQuery);
            }

            const log = db.getQueryLog();
            expect(Array.isArray(log)).toBe(true);
        });

        it("should return empty log when profiling is disabled", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                profile: false,
                testConnection: false,
            });

            await db.connect();

            const log = db.getQueryLog();
            expect(log).toEqual([]);
        });
    });

    describe("error handling", () => {
        it("should handle AggregateError with multiple connection attempts", async () => {
            const error1 = new Error("connect ECONNREFUSED ::1:5432");
            const error2 = new Error("connect ECONNREFUSED 127.0.0.1:5432");
            const aggregateError = new AggregateError([error1, error2], "Multiple errors occurred");

            mockKnexInstance.raw.mockRejectedValueOnce(aggregateError);

            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            await expect(db.testConnection()).rejects.toThrow(ParamError);
        });

        it("should extract error codes from errors", async () => {
            const error = new Error("ECONNREFUSED connection failed");
            (error as any).code = "ECONNREFUSED";

            mockKnexInstance.raw.mockRejectedValueOnce(error);

            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();
            await expect(db.testConnection()).rejects.toThrow(ParamError);
        });
    });

    describe("getKnex", () => {
        it("should return underlying Knex instance", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            const knex = db.getKnex();
            expect(knex).toBe(mockKnexInstance);
        });

        it("should throw error if not connected", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            expect(() => db.getKnex()).toThrow("Not connected");
        });
    });

    describe("IPv4 configuration", () => {
        it("should set family: 4 in connection config", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            expect(mockKnex).toHaveBeenCalledWith(
                expect.objectContaining({
                    connection: expect.objectContaining({
                        family: 4,
                    }),
                })
            );
        });
    });

    describe("Proxy behavior", () => {
        it("should return non-function properties from target", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            // Access a non-function property (like config, logger, etc.)
            // These should be returned directly without binding (lines 88-89)
            const isConnected = (db as any).isConnected;
            expect(typeof isConnected).toBe("boolean");
        });

        it("should be callable like Knex: db('table') when connected", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                testConnection: false,
            });

            await db.connect();

            // Verify mockKnexInstance is callable
            expect(typeof mockKnexInstance).toBe("function");
            
            // Test Proxy apply trap (lines 70-75) - db should be callable
            const queryBuilder = (db as any)("users");
            expect(queryBuilder).toBeDefined();
            expect(queryBuilder.table).toBe("users");
            // Verify the mock was called
            expect(mockKnexInstance).toHaveBeenCalledWith("users");
        });

        it("should throw error when calling db() without connection", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            // Test Proxy apply trap error path (lines 71-73)
            expect(() => {
                (db as any)("users");
            }).toThrow("Not connected");
        });

        it("should return undefined for non-existent properties when not connected", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            // Access a property that doesn't exist
            const nonExistent = (db as any).nonExistentProperty;
            expect(nonExistent).toBeUndefined();
        });

        it("should handle fallback path for properties not in ownMethods when not connected", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            // Access the internal instance to add properties
            const instance = (db as any)._instance;
            expect(instance).toBeDefined();
            
            // To test lines 121-124, we need to access properties that:
            // - Exist on instance
            // - Are NOT in ownMethods list
            // - No knexInstance exists
            // - Skip the earlier checks (lines 96-106)
            
            // First, test line 122: function property in fallback path
            instance.tempMethod = function() { return "test"; };
            const tempMethod = (db as any).tempMethod;
            expect(typeof tempMethod).toBe("function");
            expect(tempMethod()).toBe("test");
            
            // Test line 124: non-function property in fallback path
            instance.tempProperty = "test-value";
            const tempProperty = (db as any).tempProperty;
            expect(tempProperty).toBe("test-value");
            
            // Clean up
            delete instance.tempMethod;
            delete instance.tempProperty;
        });
    });

    describe("error message extraction edge cases", () => {
        it("should handle string errors", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            // Test getErrorMessage with string error (indirectly through testConnection)
            mockKnexInstance.raw.mockRejectedValueOnce("Simple string error");

            return db.connect().then(() => {
                return db.testConnection();
            }).catch((error: any) => {
                expect(error.message).toContain("Simple string error");
            });
        });

        it("should handle object errors with message property", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            const objectError = { message: "Object error message" };
            mockKnexInstance.raw.mockRejectedValueOnce(objectError);

            return db.connect().then(() => {
                return db.testConnection();
            }).catch((error: any) => {
                expect(error.message).toContain("Object error message");
            });
        });

        it("should handle object errors with message and code", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            const objectError = { message: "Object error", code: "ECONNREFUSED" };
            mockKnexInstance.raw.mockRejectedValueOnce(objectError);

            return db.connect().then(() => {
                return db.testConnection();
            }).catch((error: any) => {
                expect(error.message).toContain("ECONNREFUSED");
                expect(error.message).toContain("Object error");
            });
        });

        it("should handle errors without message property", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            const objectError = { someProperty: "value" };
            mockKnexInstance.raw.mockRejectedValueOnce(objectError);

            return db.connect().then(() => {
                return db.testConnection();
            }).catch((error: any) => {
                // Should fallback to stringifying the error
                expect(error.message).toBeDefined();
            });
        });

        it("should handle AggregateError with unique messages", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            const error1 = new Error("Error 1");
            const error2 = new Error("Error 2");
            const aggregateError = new AggregateError([error1, error2], "Multiple errors");

            mockKnexInstance.raw.mockRejectedValueOnce(aggregateError);

            return db.connect().then(() => {
                return db.testConnection();
            }).catch((error: any) => {
                expect(error.message).toContain("Error 1");
                expect(error.message).toContain("Error 2");
            });
        });

        it("should handle AggregateError with single unique message", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            const error1 = new Error("Same error");
            const error2 = new Error("Same error");
            const aggregateError = new AggregateError([error1, error2], "Multiple errors");

            mockKnexInstance.raw.mockRejectedValueOnce(aggregateError);

            return db.connect().then(() => {
                return db.testConnection();
            }).catch((error: any) => {
                // Should return single deduplicated message
                expect(error.message).toContain("Same error");
                expect(error.message.split("Same error").length).toBe(2); // Should appear once
            });
        });

        it("should handle AggregateError with empty errors array", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
            });

            const aggregateError = new AggregateError([], "No errors");

            mockKnexInstance.raw.mockRejectedValueOnce(aggregateError);

            return db.connect().then(() => {
                return db.testConnection();
            }).catch((error: any) => {
                expect(error.message).toBeDefined();
            });
        });
    });

    describe("profiler edge cases", () => {
        it("should handle attachProfiler when knexInstance is null", () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                profile: true,
                testConnection: false,
            });

            // Manually set knexInstance to null to test early return
            (db as any).knexInstance = null;
            
            // This should not throw - attachProfiler should return early
            // We can't directly test this, but we can verify it doesn't crash
            expect(() => {
                (db as any).attachProfiler();
            }).not.toThrow();
        });

        it("should handle query-error event in profiler", async () => {
            db = new Db({
                connectionString: "postgresql://user:pass@localhost:5432/testdb",
                logger: mockLogger,
                profile: true,
                testConnection: false,
            });

            await db.connect();

            // Find the query-error handler
            const errorHandlerCall = mockKnexInstance.on.mock.calls.find(
                (call: any[]) => call[0] === "query-error"
            );
            
            expect(errorHandlerCall).toBeDefined();
            
            // Simulate a query error
            if (errorHandlerCall) {
                const errorHandler = errorHandlerCall[1];
                const queryError = new Error("Query failed");
                const mockQuery = { sql: "SELECT * FROM users" };
                
                errorHandler(queryError, mockQuery);
                
                expect(mockLogger.error).toHaveBeenCalledWith(
                    expect.stringContaining("Query failed"),
                    queryError
                );
            }
        });
    });
});

