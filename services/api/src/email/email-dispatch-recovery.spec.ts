import { describe, expect, it } from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { emailDispatchBlockReason } from "./email-dispatch-recovery.js";

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("emailDispatchBlockReason", () => {
  it("blocks dispatch when email sending is paused", async () => {
    const killSwitch = {
      isPaused: async (key: string) => key === "platform.email_sending",
    } as unknown as KillSwitchService;

    await expect(emailDispatchBlockReason(killSwitch, TENANT)).resolves.toBe(
      "email_sending_paused",
    );
  });

  it("allows dispatch when email sending is not paused", async () => {
    const killSwitch = {
      isPaused: async () => false,
    } as unknown as KillSwitchService;

    await expect(
      emailDispatchBlockReason(killSwitch, TENANT),
    ).resolves.toBeNull();
  });

  it("fails open when the kill-switch read throws", async () => {
    const killSwitch = {
      isPaused: async () => {
        throw new Error("control-plane unavailable");
      },
    } as unknown as KillSwitchService;

    await expect(
      emailDispatchBlockReason(killSwitch, TENANT),
    ).resolves.toBeNull();
  });
});
