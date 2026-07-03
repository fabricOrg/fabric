import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  buildLogout,
  handleCallback,
  type RealmConfig,
  readSession,
  refreshSession,
} from "./index.js";

const config: RealmConfig = {
  realm: "customer",
  clientId: "client_test",
  cookieName: "wos-session",
  cookiePassword: "a-secure-test-password-at-least-32-characters",
  redirectUri: "http://localhost:3000/auth/callback",
  cookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  },
};

describe("@app/fe-auth seam", () => {
  it("fails explicitly while authorization is not implemented", () => {
    expect(() =>
      buildAuthorizationUrl(config, { state: "csrf-state" }),
    ).toThrow("buildAuthorizationUrl() is a seam stub");
  });

  it.each([
    [
      "handleCallback",
      () =>
        handleCallback(config, {
          code: "code",
          state: "state",
          expectedState: "state",
        }),
    ],
    ["readSession", () => readSession(config, "sealed-cookie")],
    ["refreshSession", () => refreshSession(config, "sealed-cookie")],
    ["buildLogout", () => buildLogout(config, "sealed-cookie")],
  ])("fails explicitly for the deferred %s flow", (_name, invoke) => {
    expect(() => invoke()).toThrow("implementation deferred to PI-2");
  });
});
