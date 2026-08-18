import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { OpenApiService } from "./openapi.service.js";
import { SECURITY_SCHEMES } from "./security-schemes.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function serviceWith(env: Record<string, string | undefined>): OpenApiService {
  return new OpenApiService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
}

interface Served {
  readonly servers: readonly { readonly url: string }[];
}

/**
 * What an operator's browser receives, as opposed to what is committed.
 *
 * These differ on exactly one field and must: the file in git is hermetic so CI can byte-compare it,
 * while the served copy has to point at the deployment the tester is looking at.
 */
describe("OpenApiService.servedDocument", () => {
  it("points the server at the configured public base url", async () => {
    const served = (await serviceWith({
      PUBLIC_API_BASE_URL: "https://fabric-jezz.onrender.com",
    }).servedDocument()) as unknown as Served;
    expect(served.servers).toEqual([
      {
        url: "https://fabric-jezz.onrender.com",
        description: "This deployment.",
      },
    ]);
  });

  it("falls back to RENDER_EXTERNAL_URL, which the platform injects", async () => {
    const served = (await serviceWith({
      RENDER_EXTERNAL_URL: "https://fabric-jezz.onrender.com/",
    }).servedDocument()) as unknown as Served;
    // Trailing slash stripped: `{base}/v1/sms` must not become `{base}//v1/sms`.
    expect(served.servers[0]?.url).toBe("https://fabric-jezz.onrender.com");
  });

  it("leaves the hermetic template alone when neither is configured", async () => {
    const service = serviceWith({});
    const served = (await service.servedDocument()) as unknown as Served;
    const committed = (await service.fullDocument()) as unknown as Served;
    expect(served.servers).toEqual(committed.servers);
    // Guessing a host would be worse than the template: a wrong absolute url silently sends every
    // trial request somewhere real.
    expect(served.servers[0]?.url).toBe("{baseUrl}");
  });

  it("does not mutate the cached artifact", async () => {
    const service = serviceWith({
      PUBLIC_API_BASE_URL: "https://example.test",
    });
    await service.servedDocument();
    const committed = (await service.fullDocument()) as unknown as Served;
    expect(committed.servers[0]?.url).toBe("{baseUrl}");
  });
});

/**
 * The header name a scheme PUBLISHES must be the header its guard READS.
 *
 * `bffInternal` advertised `x-internal-token` while `BffTokenGuard` — and all twenty-odd BFF call
 * sites — used `x-bff-token`. Nothing failed: the spec is not executed, so a wrong header name is
 * invisible to every type, test and gate until a reader follows it and gets 401 on every
 * `/internal/*` route. Reading the guard source is ugly and is the only check that actually binds
 * the two together; `route-table.ts` reflects over source for the same reason.
 */
describe("security schemes name the header their guard reads", () => {
  const GUARDS: Record<string, string> = {
    bffInternal: "../identity/bff-token.guard.ts",
    operatorToken: "../api-keys/operator-token.guard.ts",
    webhookToken: "../sms/webhook-token.guard.ts",
  };

  for (const [scheme, guardPath] of Object.entries(GUARDS)) {
    it(`${scheme}`, () => {
      const declared = (SECURITY_SCHEMES[scheme] as { name: string }).name;
      const source = readFileSync(resolve(HERE, guardPath), "utf8");
      expect(source).toContain(`headers["${declared}"]`);
    });
  }
});
