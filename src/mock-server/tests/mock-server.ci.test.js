import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockServer, createMockServer } from "../index.js";
import { Logger } from "../../logger/index.js";
import {
    maskValue,
    sanitizeUrlEncodedString,
    sanitizeObject,
    sanitizeHeaders,
    sanitizeRequestData,
    sanitizeResponseData,
    sanitizeRequest
} from "../sanitization.js";



// Create a silent logger for tests
const createTestLogger = () => {
    const context = {} ;
    return new Logger(context, { silent: true, route: "console" });
};

const testLogger = createTestLogger();

// Mock express and related modules
vi.mock("express", () => ({
    default: Object.assign(vi.fn(() => ({
        use: vi.fn(),
        get: vi.fn(),
        all: vi.fn(),
        listen: vi.fn((port, callback) => {
            callback();
            return { close: vi.fn() };
        })
    })), {
        // Mock static middleware functions
        urlencoded: vi.fn(() => "urlencoded-middleware"),
        json: vi.fn(() => "json-middleware")
    })
}));

vi.mock("http", () => ({
    default: {
        createServer: vi.fn(() => ({
            listen: vi.fn((port, callback) => {
                // Call callback immediately to simulate instant server start
                setImmediate(callback);
                // eslint-disable-next-line no-undef
                return mockServer;
            }),
            close: vi.fn((callback) => {
                // Call callback immediately to simulate instant server stop
                setImmediate(callback);
            })
        }))
    }
}));

vi.mock("morgan", () => ({
    default: Object.assign(vi.fn(() => "morgan-middleware"), {
        token: vi.fn()
    })
}));

// Mock fs and path for MockCatalog tests
vi.mock("fs/promises");
vi.mock("path");

import express from "express";
import http from "http";



describe("MockServer CI", () => {
    let server;
    let mockExpressApp;
    let mockHttpServer;
    let mockFileDb; // eslint-disable-line no-unused-vars

    beforeEach(() => {
        vi.clearAllMocks();

        // Create a mock FileDatabase instance
        mockFileDb = {
            write: vi.fn(),
            read: vi.fn(),
            hasData: vi.fn(),
            getLatestVersion: vi.fn(),
            getVersions: vi.fn()
        };

        // Setup HTTP server mock
        mockHttpServer = {
            listen: vi.fn((port, callback) => {
                // Call callback immediately to simulate instant server start
                setImmediate(callback);
                return mockHttpServer;
            }),
            close: vi.fn((callback) => {
                // Call callback immediately to simulate instant server stop
                setImmediate(callback);
            }),
            on: vi.fn() // Add the on method that MockServer.start() uses
        };

        // Setup Express mock
        mockExpressApp = {
            use: vi.fn(),
            get: vi.fn(),
            all: vi.fn(),
            listen: vi.fn((port, callback) => {
                callback();
                return mockHttpServer;
            })
        };
        (express ).mockReturnValue(mockExpressApp);

        // Setup HTTP server mock
        (http.createServer ).mockReturnValue(mockHttpServer);

        server = new MockServer({
            basePath: "/tmp/test-mocks",
            port: 5030,
            logger: testLogger
        });
    });

    afterEach(async () => {
        // Clean up any running servers
        try {
            await server.stop();
        } catch (error) {
            // Ignore errors in cleanup
        }
    });

    it("creates MockServer instance with default config", () => {
        const defaultServer = new MockServer({
            basePath: "/tmp/test",
            logger: testLogger
        });

        expect(defaultServer).toBeDefined();
    });

    it("configures Express app with middleware", () => {
        expect(express).toHaveBeenCalled();
        expect(mockExpressApp.use).toHaveBeenCalledTimes(3); // express.urlencoded, express.json, morgan
    });

    it("sets up standard routes", () => {
        expect(mockExpressApp.get).toHaveBeenCalledWith("/version", expect.any(Function));
        expect(mockExpressApp.get).toHaveBeenCalledWith("/404", expect.any(Function));
        expect(mockExpressApp.get).toHaveBeenCalledWith("/test", expect.any(Function));
        expect(mockExpressApp.all).toHaveBeenCalledWith("/*", expect.any(Function));
    });

    it("starts server successfully", async () => {
        const instance = await server.start();

        expect(mockHttpServer.listen).toHaveBeenCalledWith(5030, expect.any(Function));
        expect(instance).toHaveProperty("server");
        expect(instance).toHaveProperty("port", 5030);
        expect(instance).toHaveProperty("close");
        expect(instance).toHaveProperty("getStats");
    });

    it("stops server successfully", async () => {
        await server.start();
        await server.stop();

        expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it("handles version endpoint", async () => {
        await server.start();

        // Get the route handler
        const versionCalls = mockExpressApp.get.mock.calls.filter(call => call[0] === "/version");
        expect(versionCalls).toHaveLength(1);

        const handler = versionCalls[0][1];
        const mockRes = {
            json: vi.fn()
        };

        await handler({}, mockRes);
        expect(mockRes.json).toHaveBeenCalledWith({ version: "1.0.0", server: "MockServer" });
    });

    it("handles 404 endpoint", async () => {
        await server.start();

        const handler = mockExpressApp.get.mock.calls.find(call => call[0] === "/404")[1];
        const mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await handler({}, mockRes);
        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith({ code: "not_found", message: "not found" });
    });

    it("handles test endpoint with delay", async () => {
        await server.start();

        const handler = mockExpressApp.get.mock.calls.find(call => call[0] === "/test")[1];
        const mockReq = {
            get: vi.fn((header) => header === "x-axios-delay" ? "100" : undefined)
        };
        const mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        // Mock setTimeout to avoid waiting
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((cb) => {
            (cb )();
            return {} ;
        });

        await handler(mockReq, mockRes);

        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({
            code: "success",
            message: "success with delay 100"
        });

        vi.useRealTimers();
    });

    it("handles test endpoint with error simulation", async () => {
        await server.start();

        const handler = mockExpressApp.get.mock.calls.find(call => call[0] === "/test")[1];
        const mockReq = {
            get: vi.fn((header) => header === "x-axios-err" ? "500" : undefined)
        };
        const mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await handler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
            code: "error",
            message: "expected error 500"
        });
    });

    it("handles test endpoint with connection reset", async () => {
        await server.start();

        const handler = mockExpressApp.get.mock.calls.find(call => call[0] === "/test")[1];
        const mockReq = {
            get: vi.fn((header) => header === "x-axios-err" ? "econnreset" : undefined),
            connection: { destroy: vi.fn() },
            socket: null
        };
        const mockRes = {
            // Response methods not called for connection destroy
        };

        await handler(mockReq, mockRes);

        expect(mockReq.connection.destroy).toHaveBeenCalled();
    });

    it("handles catch-all route without XAXIOSOrigin header", async () => {
        await server.start();

        const handler = mockExpressApp.all.mock.calls.find(call => call[0] === "/*")[1];
        const mockReq = {
            get: vi.fn(() => undefined),
            method: "GET",
            url: "/api/test"
        };
        const mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await handler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({ code: "ok", message: "catch all" });
    });

    it("returns server statistics", async () => {
        const stats = server.getStats();

        expect(stats).toHaveProperty("totalRequests", 0);
        expect(stats).toHaveProperty("mockResponses", 0);
        expect(stats).toHaveProperty("fallbackResponses", 0);
        expect(stats).toHaveProperty("errors", 0);
        expect(stats).toHaveProperty("uptime");
        expect(typeof stats.uptime).toBe("number");
    });

    it("returns configuration", () => {
        const config = server.getConfig();

        expect(config).toHaveProperty("basePath", "/tmp/test-mocks");
        expect(config).toHaveProperty("port", 5030);
        expect(config).toHaveProperty("namespace", "mocks");
        expect(config).toHaveProperty("tableName", "responses");
    });

    it("configures custom sensitive keys", () => {
        const customServer = new MockServer({
            basePath: "/tmp/test",
            sensitiveKeys: ["custom_key", "secret_token"],
            logger: testLogger
        });

        const config = customServer.getConfig();
        expect(config.sensitiveKeys).toEqual(["custom_key", "secret_token"]);
    });

    it("configures custom middleware", () => {
        const customMiddleware = vi.fn();

        const _customServer = new MockServer({
            basePath: "/tmp/test",
            middleware: [customMiddleware],
            logger: testLogger
        });

        // Custom middleware should be added via app.use
        expect(mockExpressApp.use).toHaveBeenCalledWith(customMiddleware);
    });

    it("removes mock responses", async () => {
        const testServer = new MockServer({
            basePath: "/tmp/test-remove",
            port: 5031,
            logger: testLogger
        });

        const storage = (testServer ).storage;
        storage.remove = vi.fn().mockResolvedValue(true);

        const result = await testServer.removeMock("test_mock");
        expect(result).toBe(true);
        expect(storage.remove).toHaveBeenCalledWith("test_mock");
    });

    it("performs maintenance operations", async () => {
        const result = await server.maintenance();
        expect(result.cleaned).toBe(0);
    });

    it("creates and starts server with createMockServer", async () => {
        const instance = await createMockServer({
            basePath: "/tmp/create-test",
            port: 5050,
            logger: testLogger
        });

        expect(instance).toHaveProperty("server");
        expect(instance).toHaveProperty("port", 5050);
        expect(instance).toHaveProperty("close");
        expect(instance).toHaveProperty("getStats");

        // Clean up
        await instance.close();
    });
});

describe("Data Sanitization CI", () => {
    describe("maskValue", () => {
        it("should create MD5 hash with prefix", () => {
            const result = maskValue("secret");
            expect(result).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle empty strings", () => {
            const result = maskValue("");
            expect(result).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle special characters", () => {
            const result = maskValue("special!@#$%^&*()");
            expect(result).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should produce consistent results", () => {
            const result1 = maskValue("test");
            const result2 = maskValue("test");
            expect(result1).toBe(result2);
        });

        it("should produce different results for different inputs", () => {
            const result1 = maskValue("test1");
            const result2 = maskValue("test2");
            expect(result1).not.toBe(result2);
        });
    });

    describe("sanitizeUrlEncodedString", () => {
        it("should mask sensitive parameters", () => {
            const input = "client_id=123&client_secret=secret&user=test";
            const result = sanitizeUrlEncodedString(input, ["client_id", "client_secret"]);

            expect(result).toContain("user=test");
            expect(result).toMatch(/client_id=%5Bmd5%3A[a-f0-9]{32}%5D/);
            expect(result).toMatch(/client_secret=%5Bmd5%3A[a-f0-9]{32}%5D/);
        });

        it("should handle empty input", () => {
            const result = sanitizeUrlEncodedString("", ["secret"]);
            expect(result).toBe("");
        });

        it("should handle input without equals signs", () => {
            const result = sanitizeUrlEncodedString("plaintext", ["secret"]);
            expect(result).toBe("plaintext=");
        });

        it("should preserve parameter order", () => {
            const input = "a=1&b=2&c=3";
            const result = sanitizeUrlEncodedString(input, ["b"]);
            expect(result).toContain("a=1");
            expect(result).toMatch(/b=%5Bmd5%3A[a-f0-9]{32}%5D/);
            expect(result).toContain("c=3");
        });
    });

    describe("sanitizeObject", () => {
        it("should mask sensitive keys", () => {
            const input = {
                client_id: "123",
                client_secret: "secret",
                user: "test",
                password: "pass123"
            };

            const result = sanitizeObject(input, ["client_id", "client_secret", "password"]);

            expect(result.client_id).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.client_secret).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.password).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.user).toBe("test");
        });

        it("should handle nested objects", () => {
            const input = {
                user: {
                    client_id: "123",
                    name: "John"
                },
                token: "secret"
            };

            const result = sanitizeObject(input, ["client_id", "token"]);

            expect(result.user.client_id).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.user.name).toBe("John");
            expect(result.token).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle empty objects", () => {
            const result = sanitizeObject({}, ["secret"]);
            expect(result).toEqual({});
        });

        it("should handle null/undefined input", () => {
            expect(sanitizeObject(null, ["secret"])).toEqual({});
            expect(sanitizeObject(undefined, ["secret"])).toEqual({});
        });

        it("should handle arrays", () => {
            const input = ["item1", "item2"];
            const result = sanitizeObject(input, ["secret"]);
            expect(result).toEqual(["item1", "item2"]);
        });
    });

    describe("sanitizeHeaders", () => {
        it("should mask authorization headers", () => {
            const headers = {
                "authorization": "Bearer token123",
                "content-type": "application/json",
                "x-api-key": "secret"
            };

            const result = sanitizeHeaders(headers, ["x-api-key"]);

            expect(result.authorization).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result["content-type"]).toBe("application/json");
            expect(result["x-api-key"]).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle case-insensitive matching", () => {
            const headers = {
                "AUTHORIZATION": "Bearer token123",
                "Content-Type": "application/json"
            };

            const result = sanitizeHeaders(headers);

            expect(result.AUTHORIZATION).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result["Content-Type"]).toBe("application/json");
        });

        it("should accept additional sensitive keys", () => {
            const headers = {
                "custom-token": "secret",
                "normal-header": "value"
            };

            const result = sanitizeHeaders(headers, ["custom-token"]);

            expect(result["custom-token"]).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result["normal-header"]).toBe("value");
        });

        it("should handle empty headers", () => {
            const result = sanitizeHeaders({});
            expect(result).toEqual({});
        });
    });

    describe("sanitizeRequestData", () => {
        it("should handle URL-encoded string data", () => {
            const result = sanitizeRequestData("username=test&password=secret&api_key=key123", ["password", "api_key"]);
            expect(result).toContain("username=test");
            expect(result).toMatch(/password=%5Bmd5%3A[a-f0-9]{32}%5D/);
            expect(result).toMatch(/api_key=%5Bmd5%3A[a-f0-9]{32}%5D/);
        });

        it("should handle object data", () => {
            const input = { username: "test", password: "secret", api_key: "key123" };
            const result = sanitizeRequestData(input, ["password", "api_key"]);
            expect(result.username).toBe("test");
            expect(result.password).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.api_key).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle plain strings", () => {
            const result = sanitizeRequestData("plaintext data", ["secret"]);
            expect(result).toBe("plaintext data");
        });

        it("should handle numbers and booleans", () => {
            expect(sanitizeRequestData(123, ["secret"])).toBe(123);
            expect(sanitizeRequestData(true, ["secret"])).toBe(true);
            expect(sanitizeRequestData(false, ["secret"])).toBe(false);
        });

        it("should handle malformed URL-encoded strings", () => {
            const result = sanitizeRequestData("invalid%json", ["password"]);
            expect(result).toBe("invalid%json");
        });
    });

    describe("sanitizeResponseData", () => {
        it("should sanitize object data", () => {
            const input = { token: "secret", data: "public" };
            const result = sanitizeResponseData(input, ["token"]);
            expect(result.token).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.data).toBe("public");
        });

        it("should handle non-object data", () => {
            expect(sanitizeResponseData("string", ["secret"])).toBe("string");
            expect(sanitizeResponseData(123, ["secret"])).toBe(123);
            expect(sanitizeResponseData(null, ["secret"])).toBe(null);
        });
    });

    describe("sanitizeRequest", () => {
        it("should sanitize complete request", () => {
            const params = {
                query: "user=test&password=secret",
                requestData: { api_key: "key123", data: "value" },
                headers: { "authorization": "Bearer token", "content-type": "application/json" },
                data: { token: "response_secret", result: "data" }
            };

            const result = sanitizeRequest(params, ["password", "api_key", "authorization", "token"]);

            expect(result.query).toContain("user=test");
            expect(result.query).toMatch(/password=%5Bmd5%3A[a-f0-9]{32}%5D/);
            expect(result.requestData.api_key).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.requestData.data).toBe("value");
            expect(result.headers.authorization).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.headers["content-type"]).toBe("application/json");
            expect(result.data.token).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.data.result).toBe("data");
        });

        it("should handle missing optional parameters", () => {
            const params = {
                query: "user=test",
                headers: { "content-type": "application/json" }
            };

            const result = sanitizeRequest(params, ["password"]);

            expect(result.query).toBe("user=test");
            expect(result.headers["content-type"]).toBe("application/json");
            expect(result.requestData).toBeUndefined();
            expect(result.data).toBeUndefined();
        });

        it("should handle empty sensitive keys array", () => {
            const params = {
                query: "user=test&password=secret",
                requestData: { api_key: "key123" },
                headers: { "authorization": "Bearer token", "normal-header": "value" }
            };

            const result = sanitizeRequest(params, []);

            // Query and requestData should not be sanitized with empty keys array
            expect(result.query).toBe("user=test&password=secret");
            expect(result.requestData.api_key).toBe("key123");

            // But authorization headers are always masked
            expect(result.headers.authorization).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.headers["normal-header"]).toBe("value");
        });
    });
});
