import { describe, expect, it, vi } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { MessageDefinitionsController } from "./message-definitions.controller.js";
import type { MessageDefinitionsService } from "./message-definitions.service.js";

const TID = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";

function controllerWith() {
  const svc = {
    list: vi.fn(async () => ({ definitions: [] })),
    create: vi.fn(async () => ({
      definition: {},
      latest_version: null,
      releases: [],
    })),
    addVersion: vi.fn(),
    publish: vi.fn(),
    archive: vi.fn(async () => undefined),
  };
  return {
    ctl: new MessageDefinitionsController(
      svc as unknown as MessageDefinitionsService,
    ),
    svc,
  };
}

/** BFF dashboard session: tenant token, isSessionToken true, app/env null. */
function sessionReq(tenantId: string): { tenant: RequestTenant } {
  return {
    tenant: {
      id: tenantId,
      scopes: ["*"],
      keyId: `bfft_${tenantId.slice(0, 8)}`,
      applicationId: null,
      environmentId: null,
      isSessionToken: true,
    },
  };
}

/** A data-plane sk_* key: isSessionToken false, applicationId/environmentId populated. */
function apiKeyReq(tenantId: string): { tenant: RequestTenant } {
  return {
    tenant: {
      id: tenantId,
      scopes: ["sms:send"],
      keyId: "key_live_x",
      applicationId: "app-1",
      environmentId: "env-1",
      isSessionToken: false,
    },
  };
}

/**
 * The escalation vector: a runtime sk_* key whose row has a NULL application_id (legacy/un-backfilled
 * — the column is nullable and the NOT-NULL follow-up never shipped). It looks exactly like a session
 * to the old `applicationId === null` proxy, so the gate must reject it on `isSessionToken` instead.
 */
function nullAppKeyReq(tenantId: string): { tenant: RequestTenant } {
  return {
    tenant: {
      id: tenantId,
      scopes: ["sms:send"],
      keyId: "key_legacy_nullapp",
      applicationId: null,
      environmentId: null,
      isSessionToken: false,
    },
  };
}

describe("MessageDefinitionsController authority (ADR-0005 #6)", () => {
  it("session path: uses the token's tenant, ignores a client tenantId", async () => {
    const { ctl, svc } = controllerWith();
    await ctl.list(sessionReq(TID), OTHER, undefined);
    expect(svc.list).toHaveBeenCalledWith(TID, undefined);
  });

  it("operator path: uses the operator-supplied tenant", async () => {
    const { ctl, svc } = controllerWith();
    await ctl.list({}, TID, undefined);
    expect(svc.list).toHaveBeenCalledWith(TID, undefined);
  });

  it("rejects a data-plane sk_* key — management requires a session", () => {
    const { ctl, svc } = controllerWith();
    // Guard clauses throw synchronously (the handler returns the service promise directly).
    expectHttpError(() => ctl.list(apiKeyReq(TID), undefined, undefined), 403, {
      code: "management_requires_session",
    });
    expect(svc.list).not.toHaveBeenCalled();
  });

  it("rejects an sk_* key on create too", () => {
    const { ctl, svc } = controllerWith();
    expectHttpError(
      () => ctl.create(apiKeyReq(TID), { key: "order.shipped" }),
      403,
      {
        code: "management_requires_session",
      },
    );
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("rejects a runtime key with a NULL application_id (the escalation vector)", () => {
    // Regression for the ADR-0005 #6 review finding: pre-fix, this key passed because the gate keyed
    // on applicationId === null. It must now be rejected as a non-session credential.
    const { ctl, svc } = controllerWith();
    expectHttpError(
      () => ctl.create(nullAppKeyReq(TID), { key: "order.shipped" }),
      403,
      { code: "management_requires_session" },
    );
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("create: 400 invalid_definition on a bad key", () => {
    const { ctl } = controllerWith();
    expectHttpError(
      () => ctl.create(sessionReq(TID), { key: "Bad Key!" }),
      400,
      {
        type: "invalid_request_error",
      },
    );
  });
});

function expectHttpError(
  run: () => unknown,
  status: number,
  errorFields: Record<string, string>,
): void {
  try {
    run();
    expect.unreachable("should have thrown");
  } catch (e) {
    const ex = e as {
      getStatus(): number;
      getResponse(): { error: Record<string, string> };
    };
    expect(ex.getStatus()).toBe(status);
    expect(ex.getResponse().error).toMatchObject(errorFields);
  }
}
