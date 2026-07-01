import { describe, expect, it } from "vitest";
import {
  type ApiKeyEnv,
  generateApiKey,
  hashApiKey,
  parseApiKeyEnv,
  safeHashEqual,
} from "./api-key.crypto.js";

describe("api-key crypto (F2.3)", () => {
  it("mints a prefixed key and stores only the hash + display prefix", () => {
    const k = generateApiKey("test");
    expect(k.raw.startsWith("sk_test_")).toBe(true);
    expect(k.env).toBe("test");
    // prefix is a safe leading slice, NOT the whole key
    expect(k.raw.startsWith(k.prefix)).toBe(true);
    expect(k.prefix.length).toBeLessThan(k.raw.length);
    // the stored hash is not the raw key and is a 64-char sha256 hex
    expect(k.keyHash).not.toBe(k.raw);
    expect(k.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.keyHash).toBe(hashApiKey(k.raw));
  });

  it("live keys carry the live prefix", () => {
    expect(generateApiKey("live").raw.startsWith("sk_live_")).toBe(true);
  });

  it("generates unique, high-entropy keys (no collisions across a batch)", () => {
    const raws = new Set(
      Array.from({ length: 200 }, () => generateApiKey("test").raw),
    );
    expect(raws.size).toBe(200);
  });

  it("hashApiKey is deterministic and differs per key", () => {
    const a = generateApiKey("test");
    const b = generateApiKey("test");
    expect(hashApiKey(a.raw)).toBe(a.keyHash);
    expect(hashApiKey(a.raw)).not.toBe(hashApiKey(b.raw));
  });

  it("parses the environment from the prefix, rejects malformed keys", () => {
    expect(parseApiKeyEnv(generateApiKey("test").raw)).toBe("test");
    expect(parseApiKeyEnv(generateApiKey("live").raw)).toBe("live");
    expect(parseApiKeyEnv("nope")).toBeNull();
    expect(parseApiKeyEnv("")).toBeNull();
    expect(parseApiKeyEnv("pk_test_x")).toBeNull();
  });

  it("safeHashEqual is true for equal hashes, false otherwise (and length-safe)", () => {
    const h = generateApiKey("test").keyHash;
    expect(safeHashEqual(h, h)).toBe(true);
    expect(safeHashEqual(h, hashApiKey("other"))).toBe(false);
    expect(safeHashEqual(h, "short")).toBe(false); // unequal length → false, no throw
  });

  it("covers both envs via the ApiKeyEnv union", () => {
    const envs: ApiKeyEnv[] = ["test", "live"];
    for (const e of envs) expect(generateApiKey(e).env).toBe(e);
  });
});
