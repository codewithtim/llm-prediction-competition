import { describe, expect, it } from "bun:test";
import { decrypt, encrypt } from "../../../src/shared/crypto";

const TEST_KEY = "test-encryption-key-for-unit-tests";

describe("crypto", () => {
  it("round-trips encrypt and decrypt", () => {
    const plaintext = "my-secret-private-key-0x1234";
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for different plaintexts", () => {
    const a = encrypt("secret-a", TEST_KEY);
    const b = encrypt("secret-b", TEST_KEY);
    expect(a).not.toBe(b);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const a = encrypt("same-secret", TEST_KEY);
    const b = encrypt("same-secret", TEST_KEY);
    expect(a).not.toBe(b);
    // Both should decrypt to the same value
    expect(decrypt(a, TEST_KEY)).toBe("same-secret");
    expect(decrypt(b, TEST_KEY)).toBe("same-secret");
  });

  it("fails to decrypt with wrong key", () => {
    const encrypted = encrypt("my-secret", TEST_KEY);
    expect(() => decrypt(encrypted, "wrong-key")).toThrow();
  });

  it("fails on invalid encrypted format", () => {
    expect(() => decrypt("not-valid-format", TEST_KEY)).toThrow("Invalid encrypted format");
  });

  it("handles long values", () => {
    const longValue = "x".repeat(10000);
    const encrypted = encrypt(longValue, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(longValue);
  });
});
