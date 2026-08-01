import { describe, expect, it, vi } from "vitest";
import { runScheduledTokenExpiry } from "./token-expiry.scheduler.js";

describe("token expiry production trigger", () => {
  it("drives the expiry seam when the scheduler role enables it", async () => {
    const run = vi.fn().mockResolvedValue({ locked: true, expired: 2 });
    await runScheduledTokenExpiry({ enabled: true, run, onError: vi.fn() });
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not run on a role where scheduling is disabled", async () => {
    const run = vi.fn();
    await runScheduledTokenExpiry({ enabled: false, run, onError: vi.fn() });
    expect(run).not.toHaveBeenCalled();
  });

  it("contains a failed tick so the next schedule can retry", async () => {
    const onError = vi.fn();
    await runScheduledTokenExpiry({
      enabled: true,
      run: vi.fn().mockRejectedValue(new Error("database unavailable")),
      onError,
    });
    expect(onError).toHaveBeenCalledWith("database unavailable");
  });
});
