import { describe, expect, it } from "vitest";
import { canSeeNavCommand, canSeeNavItem, navCommands, navGroups } from "./nav";

describe("funding navigation visibility", () => {
  const walletItem = navGroups
    .flatMap((group) => group.items)
    .find((item) => item.href === "/wallet");
  const walletCommand = navCommands.find((item) => item.href === "/wallet");

  it("hides wallet navigation and command search in sandbox", () => {
    expect(walletItem).toBeDefined();
    expect(walletCommand).toBeDefined();
    if (!walletItem || !walletCommand) return;
    const context = {
      permissions: ["wallet:read"],
      role: "owner",
      plan: "sandbox",
    };
    expect(canSeeNavItem(walletItem, context)).toBe(false);
    expect(canSeeNavCommand(walletCommand, context)).toBe(false);
  });

  it("shows billing and tokens to an authorized live workspace member", () => {
    if (!walletItem || !walletCommand) return;
    const context = {
      permissions: ["wallet:read"],
      role: "member",
      plan: "growth",
    };
    expect(canSeeNavItem(walletItem, context)).toBe(true);
    expect(canSeeNavCommand(walletCommand, context)).toBe(true);
  });
});
