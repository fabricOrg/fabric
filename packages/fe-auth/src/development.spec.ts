import { describe, expect, it } from "vitest";
import {
  type DevelopmentSessionConfig,
  readDevelopmentSession,
  sealDevelopmentSession,
} from "./development.js";
import type { AppSession } from "./index.js";

const config: DevelopmentSessionConfig = {
  enabled: true,
  runtime: "test",
  cookiePassword: "local-session-password-with-more-than-32-characters",
  ttlSeconds: 60,
};
const session: AppSession = {
  userId: "dev-user",
  orgId: "00000000-0000-0000-0000-0000000000d1",
  role: "owner",
  permissions: ["sms:send", "sms:read", "wallet:read"],
  sessionId: "dev-session",
};

describe("development session", () => {
  it("round-trips encrypted tenant-pinned claims", () => {
    const sealed = sealDevelopmentSession(config, session, 1_000);
    expect(sealed).not.toContain(session.orgId);
    expect(readDevelopmentSession(config, sealed, 2_000)).toEqual(session);
  });

  it("fails closed for tampering and expiry", () => {
    const sealed = sealDevelopmentSession(config, session, 1_000);
    expect(readDevelopmentSession(config, `${sealed}x`, 2_000)).toBeNull();
    expect(readDevelopmentSession(config, sealed, 61_001)).toBeNull();
  });

  it("cannot be issued when disabled or in production", () => {
    expect(() =>
      sealDevelopmentSession({ ...config, enabled: false }, session),
    ).toThrow("disabled");
    expect(() =>
      sealDevelopmentSession({ ...config, runtime: "production" }, session),
    ).toThrow("disabled");
  });
});
