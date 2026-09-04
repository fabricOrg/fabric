import { describe, expect, it } from "vitest";
import { GET, POST } from "./route.js";

describe("campaigns BFF", () => {
  it.each([
    ["GET", GET],
    ["POST", POST],
  ])("fails closed for %s until campaign execution exists", async (_, call) => {
    const response = await call();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        type: "api_error",
        code: "campaigns_not_configured",
        message: "Campaigns are not available yet.",
      },
    });
  });
});
