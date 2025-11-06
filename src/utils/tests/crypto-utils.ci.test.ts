import { describe, it, expect } from "vitest";
import { md5, maskValue } from "../crypto-utils.js";

describe("Crypto Utils CI", () => {
    describe("md5", () => {
        it("generates consistent hash for same input", () => {
            const input = "test-string";
            const hash1 = md5(input);
            const hash2 = md5(input);
            expect(hash1).toBe(hash2);
        });

        it("generates different hashes for different inputs", () => {
            const hash1 = md5("string1");
            const hash2 = md5("string2");
            expect(hash1).not.toBe(hash2);
        });

        it("generates 32-character hexadecimal hash", () => {
            const hash = md5("test");
            expect(hash).toMatch(/^[a-f0-9]{32}$/);
            expect(hash.length).toBe(32);
        });

        it("handles empty string", () => {
            const hash = md5("");
            expect(hash).toBe("d41d8cd98f00b204e9800998ecf8427e"); // Known MD5 of empty string
        });

        it("handles special characters", () => {
            const hash1 = md5("hello@world!#$%");
            const hash2 = md5("hello@world!#$%");
            expect(hash1).toBe(hash2);
            expect(hash1).toMatch(/^[a-f0-9]{32}$/);
        });

        it("handles unicode characters", () => {
            const hash1 = md5("こんにちは"); // Japanese
            const hash2 = md5("こんにちは");
            expect(hash1).toBe(hash2);
            expect(hash1).toMatch(/^[a-f0-9]{32}$/);
        });

        it("handles long strings", () => {
            const longString = "a".repeat(10000);
            const hash = md5(longString);
            expect(hash).toMatch(/^[a-f0-9]{32}$/);
        });

        it("produces known MD5 hashes for test vectors", () => {
            // Standard MD5 test vectors
            expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
            expect(md5("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
            expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
            expect(md5("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
        });

        it("is case sensitive", () => {
            const hash1 = md5("Hello");
            const hash2 = md5("hello");
            expect(hash1).not.toBe(hash2);
        });
    });

    describe("maskValue", () => {
        it("masks value with MD5 hash in brackets", () => {
            const result = maskValue("sensitive-data");
            expect(result).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("generates consistent masked values for same input", () => {
            const input = "password123";
            const masked1 = maskValue(input);
            const masked2 = maskValue(input);
            expect(masked1).toBe(masked2);
        });

        it("generates different masked values for different inputs", () => {
            const masked1 = maskValue("value1");
            const masked2 = maskValue("value2");
            expect(masked1).not.toBe(masked2);
        });

        it("includes [md5: prefix and ] suffix", () => {
            const result = maskValue("test");
            expect(result.startsWith("[md5:")).toBe(true);
            expect(result.endsWith("]")).toBe(true);
        });

        it("masks empty string", () => {
            const result = maskValue("");
            expect(result).toBe("[md5:d41d8cd98f00b204e9800998ecf8427e]");
        });

        it("masks sensitive credentials", () => {
            const password = "mySecretPassword123!";
            const masked = maskValue(password);
            
            expect(masked).not.toContain("mySecret");
            expect(masked).not.toContain("Password");
            expect(masked).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("is useful for logging without exposing data", () => {
            const apiKey = "sk_live_abc123xyz789";
            const masked = maskValue(apiKey);
            
            // The masked value should not contain the original API key
            expect(masked).not.toContain("sk_live");
            expect(masked).not.toContain("abc123");
            
            // But can be used to track the same key across logs
            const maskedAgain = maskValue(apiKey);
            expect(masked).toBe(maskedAgain);
        });

        it("handles unicode in masked values", () => {
            const result = maskValue("パスワード");
            expect(result).toMatch(/^\[md5:[a-f0-9]{32}\]$/);
        });

        it("creates traceable but hidden values", () => {
            const value1 = "user_token_abc";
            const value2 = "user_token_abc";
            const value3 = "user_token_xyz";
            
            const masked1 = maskValue(value1);
            const masked2 = maskValue(value2);
            const masked3 = maskValue(value3);
            
            // Same input produces same mask (traceable)
            expect(masked1).toBe(masked2);
            
            // Different input produces different mask
            expect(masked1).not.toBe(masked3);
            
            // But original value is not visible
            expect(masked1).not.toContain("token");
            expect(masked1).not.toContain("abc");
        });
    });

    describe("md5 and maskValue integration", () => {
        it("maskValue uses md5 internally", () => {
            const value = "test-value";
            const hash = md5(value);
            const masked = maskValue(value);
            
            expect(masked).toBe(`[md5:${hash}]`);
        });

        it("can extract hash from masked value", () => {
            const value = "secret-data";
            const directHash = md5(value);
            const masked = maskValue(value);
            
            const extractedHash = masked.slice(5, -1); // Remove "[md5:" and "]"
            expect(extractedHash).toBe(directHash);
        });
    });
});

