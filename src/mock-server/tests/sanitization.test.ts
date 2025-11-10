import { describe, it, expect } from "vitest";
import * as sanitization from "../sanitization";

describe("Data Sanitization", () => {
    describe("maskValue", () => {
        it("should create MD5 hash with prefix", () => {
            const result = sanitization.maskValue("secret123");
            expect(result).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle empty strings", () => {
            const result = sanitization.maskValue("");
            expect(result).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle special characters", () => {
            const result = sanitization.maskValue("special@#$%^&*()");
            expect(result).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should produce consistent results", () => {
            const result1 = sanitization.maskValue("test");
            const result2 = sanitization.maskValue("test");
            expect(result1).toBe(result2);
        });

        it("should produce different results for different inputs", () => {
            const result1 = sanitization.maskValue("test1");
            const result2 = sanitization.maskValue("test2");
            expect(result1).not.toBe(result2);
        });
    });

    describe("sanitizeUrlEncodedString", () => {
        it("should mask sensitive parameters", () => {
            const input = "client_id=123&client_secret=secret&user=test";
            const result = sanitization.sanitizeUrlEncodedString(input, ["client_id", "client_secret"]);

            expect(result).toContain("client_id=");
            expect(result).toContain("client_secret=");
            expect(result).toContain("user=test");
            // URL-encoded version of [md5:hash]
            expect(result).toMatch(/client_id=%5Bmd5%3A[a-f0-9]{32}%5D/);
            expect(result).toMatch(/client_secret=%5Bmd5%3A[a-f0-9]{32}%5D/);
        });

        it("should handle empty input", () => {
            const result = sanitization.sanitizeUrlEncodedString("", ["secret"]);
            expect(result).toBe("");
        });

        it("should handle input without equals signs", () => {
            const input = "not-a-valid-query-string";
            const result = sanitization.sanitizeUrlEncodedString(input, ["secret"]);
            // querystring.parse treats this as a key with empty value
            expect(result).toBe("not-a-valid-query-string=");
        });

        it("should preserve parameter order", () => {
            const input = "a=1&b=2&c=3";
            const result = sanitization.sanitizeUrlEncodedString(input, ["b"]);
            expect(result).toMatch(/^a=1&b=%5Bmd5%3A[a-f0-9]{32}%5D&c=3$/);
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

            const result = sanitization.sanitizeObject(input, ["client_id", "client_secret", "password"]);

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
                api_key: "secret"
            };

            const result = sanitization.sanitizeObject(input, ["client_id", "api_key"]);

            expect(result.user.client_id).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.user.name).toBe("John");
            expect(result.api_key).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle empty objects", () => {
            const result = sanitization.sanitizeObject({}, ["secret"]);
            expect(result).toEqual({});
        });

        it("should handle null/undefined input", () => {
            expect(sanitization.sanitizeObject(null, ["secret"])).toEqual({});
            expect(sanitization.sanitizeObject(undefined, ["secret"])).toEqual({});
        });

        it("should handle arrays", () => {
            const input = ["client_id", "normal"];
            const result = sanitization.sanitizeObject(input, ["client_id"]);
            // Arrays are returned as-is since we don't sanitize array elements
            expect(result).toEqual(input);
        });
    });

    describe("sanitizeHeaders", () => {
        it("should mask authorization headers", () => {
            const input = {
                "authorization": "Bearer token123",
                "content-type": "application/json",
                "x-api-key": "secret456"
            };

            const result = sanitization.sanitizeHeaders(input);

            expect(result.authorization).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result["content-type"]).toBe("application/json");
            expect(result["x-api-key"]).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should handle case-insensitive matching", () => {
            const input = {
                "Authorization": "Bearer token123",
                "AUTHORIZATION": "Bearer token456"
            };

            const result = sanitization.sanitizeHeaders(input);

            expect(result.Authorization).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.AUTHORIZATION).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("should accept additional sensitive keys", () => {
            const input = {
                "custom-token": "secret123",
                "normal-header": "value"
            };

            const result = sanitization.sanitizeHeaders(input, ["custom-token"]);

            expect(result["custom-token"]).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result["normal-header"]).toBe("value");
        });

        it("should handle empty headers", () => {
            const result = sanitization.sanitizeHeaders({});
            expect(result).toEqual({});
        });
    });

    describe("sanitizeRequestData", () => {
        it("should handle URL-encoded string data", () => {
            const input = "client_id=123&password=secret&user=test";
            const result = sanitization.sanitizeRequestData(input, ["client_id", "password"]);

            expect(result).toContain("client_id=");
            expect(result).toContain("password=");
            expect(result).toContain("user=test");
            expect(result).toMatch(/client_id=%5Bmd5%3A[a-f0-9]{32}%5D/);
        });

        it("should handle object data", () => {
            const input = {
                client_id: "123",
                password: "secret",
                user: "test"
            };

            const result = sanitization.sanitizeRequestData(input, ["client_id", "password"]);

            expect(result.client_id).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.password).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.user).toBe("test");
        });

        it("should handle plain strings", () => {
            const input = "plain text data";
            const result = sanitization.sanitizeRequestData(input, ["secret"]);
            // Since it doesn't contain '=', it's treated as plain text
            expect(result).toBe("plain text data");
        });

        it("should handle numbers and booleans", () => {
            expect(sanitization.sanitizeRequestData(123, ["secret"])).toBe(123);
            expect(sanitization.sanitizeRequestData(true, ["secret"])).toBe(true);
            expect(sanitization.sanitizeRequestData(null, ["secret"])).toBe(null);
        });

        it("should handle malformed URL-encoded strings", () => {
            const input = "not-valid-url-encoding!!!";
            const result = sanitization.sanitizeRequestData(input, ["secret"]);
            // Since it doesn't contain '=', it's treated as plain text
            expect(result).toBe(input);
        });

    });

    describe("sanitizeResponseData", () => {
        it("should sanitize object data", () => {
            const input = {
                api_key: "secret123",
                user: "test",
                token: "token456"
            };

            const result = sanitization.sanitizeResponseData(input, ["api_key", "token"]);

            expect(result.api_key).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.token).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.user).toBe("test");
        });

        it("should handle non-object data", () => {
            expect(sanitization.sanitizeResponseData("string", ["secret"])).toBe("string");
            expect(sanitization.sanitizeResponseData(123, ["secret"])).toBe(123);
            expect(sanitization.sanitizeResponseData(null, ["secret"])).toBe(null);
            expect(sanitization.sanitizeResponseData(undefined, ["secret"])).toBe(undefined);
        });
    });

    describe("sanitizeRequest", () => {
        it("should sanitize complete request", () => {
            const params = {
                query: "client_id=123&user=test",
                requestData: {
                    password: "secret123",
                    email: "user@example.com"
                },
                headers: {
                    "authorization": "Bearer token456",
                    "content-type": "application/json"
                },
                data: {
                    api_key: "key789",
                    result: "success"
                }
            };

            const result = sanitization.sanitizeRequest(params, ["client_id", "password", "authorization", "api_key"]);

            // Check query sanitization
            expect(result.query).toMatch(/client_id=%5Bmd5%3A[a-f0-9]{32}%5D/);
            expect(result.query).toContain("user=test");

            // Check request data sanitization
            expect(result.requestData?.password).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.requestData?.email).toBe("user@example.com");

            // Check header sanitization
            expect(result.headers.authorization).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.headers["content-type"]).toBe("application/json");

            // Check response data sanitization
            expect(result.data.api_key).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.data.result).toBe("success");
        });

        it("should handle missing optional parameters", () => {
            const params = {
                query: "user=test"
            };

            const result = sanitization.sanitizeRequest(params, ["secret"]);

            expect(result.query).toBe("user=test");
            expect(result.requestData).toBeUndefined();
            expect(result.headers).toEqual({});
            expect(result.data).toBeUndefined();
        });

        it("should handle empty sensitive keys array", () => {
            const params = {
                query: "client_id=123&user=test",
                headers: { "authorization": "Bearer token" },
                data: { secret: "value" }
            };

            const result = sanitization.sanitizeRequest(params, []);

            // Default sensitive headers (like authorization) are still sanitized
            expect(result.query).toBe("client_id=123&user=test");
            expect(result.headers.authorization).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
            expect(result.data).toStrictEqual(params.data);
        });
    });
});
