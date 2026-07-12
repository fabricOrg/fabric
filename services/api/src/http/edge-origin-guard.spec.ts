import { describe, expect, it } from "vitest";
import { edgeOriginAllowed } from "./edge-origin-guard.js";

describe("edgeOriginAllowed", () => {
  it("allows all requests when the edge secret is not configured", () => {
    expect(
      edgeOriginAllowed({ headers: {}, url: "/v1/messages" }, undefined),
    ).toBe(true);
  });

  it("allows requests with the expected CloudFront origin header", () => {
    expect(
      edgeOriginAllowed(
        {
          headers: { "x-fabric-edge-secret": "secret" },
          url: "/v1/messages",
        },
        "secret",
      ),
    ).toBe(true);
  });

  it("rejects public requests without the expected edge header", () => {
    expect(edgeOriginAllowed({ headers: {}, url: "/health" }, "secret")).toBe(
      false,
    );
  });

  it("keeps the local ECS container health check working", () => {
    expect(
      edgeOriginAllowed(
        { headers: { host: "127.0.0.1:3000" }, url: "/health" },
        "secret",
      ),
    ).toBe(true);
  });
});
