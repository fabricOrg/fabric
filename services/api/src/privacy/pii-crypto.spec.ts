import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptPii,
  encryptPii,
  maskMsisdn,
  newDek,
  normalizeE164,
  phoneBlindIndex,
  unwrapDek,
  wrapDek,
} from "./pii-crypto.js";

const MASTER = randomBytes(32);
const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";
const SUBJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SUBJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("DEK envelope", () => {
  it("round-trips a wrapped DEK", () => {
    const dek = newDek();
    const wrapped = wrapDek(MASTER, dek, TENANT, SUBJECT);
    expect(wrapped.equals(dek)).toBe(false); // never stored in the clear
    expect(unwrapDek(MASTER, wrapped, TENANT, SUBJECT).equals(dek)).toBe(true);
  });

  it("refuses to unwrap a DEK against a different subject or tenant", () => {
    const wrapped = wrapDek(MASTER, newDek(), TENANT, SUBJECT);
    // The AAD binds the wrap to its owner: a DEK row copied onto another subject is inert.
    expect(() => unwrapDek(MASTER, wrapped, TENANT, OTHER_SUBJECT)).toThrow();
    expect(() => unwrapDek(MASTER, wrapped, OTHER_TENANT, SUBJECT)).toThrow();
  });

  it("refuses to unwrap under the wrong master key", () => {
    const wrapped = wrapDek(MASTER, newDek(), TENANT, SUBJECT);
    expect(() =>
      unwrapDek(randomBytes(32), wrapped, TENANT, SUBJECT),
    ).toThrow();
  });
});

describe("PII sealing", () => {
  const dek = newDek();

  it("round-trips a value and never stores it in the clear", () => {
    const sealed = encryptPii(dek, "+233545227189", TENANT, SUBJECT, "phone");
    expect(sealed.toString("utf8")).not.toContain("+233545227189");
    expect(decryptPii(dek, sealed, TENANT, SUBJECT, "phone")).toBe(
      "+233545227189",
    );
  });

  // The reason the AAD exists: a ciphertext lifted from one context must not decrypt in another,
  // even with the same key. Without this, a row swap across tenants would read cleanly.
  it("rejects a ciphertext replayed into another tenant, subject, or kind", () => {
    const sealed = encryptPii(dek, "secret body", TENANT, SUBJECT, "body");
    expect(() =>
      decryptPii(dek, sealed, OTHER_TENANT, SUBJECT, "body"),
    ).toThrow();
    expect(() =>
      decryptPii(dek, sealed, TENANT, OTHER_SUBJECT, "body"),
    ).toThrow();
    expect(() => decryptPii(dek, sealed, TENANT, SUBJECT, "phone")).toThrow();
  });

  it("rejects a tampered auth tag or body", () => {
    const sealed = encryptPii(dek, "secret body", TENANT, SUBJECT, "body");

    const tamperedTag = Buffer.from(sealed);
    tamperedTag.writeUInt8(tamperedTag.readUInt8(13) ^ 0xff, 13); // a tag byte
    expect(() =>
      decryptPii(dek, tamperedTag, TENANT, SUBJECT, "body"),
    ).toThrow();

    const tamperedBody = Buffer.from(sealed);
    const last = tamperedBody.length - 1;
    tamperedBody.writeUInt8(tamperedBody.readUInt8(last) ^ 0xff, last);
    expect(() =>
      decryptPii(dek, tamperedBody, TENANT, SUBJECT, "body"),
    ).toThrow();
  });

  it("rejects a truncated ciphertext instead of reading past the buffer", () => {
    expect(() =>
      decryptPii(dek, Buffer.alloc(4), TENANT, SUBJECT, "body"),
    ).toThrow(/Malformed/);
  });

  it("produces a different ciphertext each time (fresh IV)", () => {
    const a = encryptPii(dek, "same", TENANT, SUBJECT, "body");
    const b = encryptPii(dek, "same", TENANT, SUBJECT, "body");
    expect(a.equals(b)).toBe(false);
  });
});

describe("phone blind index", () => {
  const key = randomBytes(32);

  it("is stable across formatting so one human number is one subject", () => {
    const a = phoneBlindIndex(key, TENANT, "+233 545-227189");
    const b = phoneBlindIndex(key, TENANT, "+233545227189");
    expect(a).toBe(b);
  });

  it("is tenant-scoped — one tenant cannot probe another's recipients", () => {
    expect(phoneBlindIndex(key, TENANT, "+233545227189")).not.toBe(
      phoneBlindIndex(key, OTHER_TENANT, "+233545227189"),
    );
  });

  it("does not reveal the number", () => {
    expect(phoneBlindIndex(key, TENANT, "+233545227189")).not.toContain(
      "545227189",
    );
  });

  it("is keyed — an attacker who cannot see the index key cannot rebuild it", () => {
    expect(phoneBlindIndex(key, TENANT, "+233545227189")).not.toBe(
      phoneBlindIndex(randomBytes(32), TENANT, "+233545227189"),
    );
  });
});

describe("display helpers", () => {
  it("masks the subscriber digits", () => {
    expect(maskMsisdn("+233545227189")).toBe("+23354•••7189");
  });

  it("normalizes separators", () => {
    expect(normalizeE164("+233 (545) 227-189")).toBe("+233545227189");
  });
});
