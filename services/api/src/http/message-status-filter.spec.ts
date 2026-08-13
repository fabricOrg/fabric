import { describe, expect, it } from "vitest";
import { parseMessageStatusGroup } from "./message-status-filter.js";

describe("parseMessageStatusGroup", () => {
  it("accepts the dashboard groups and an omitted filter", () => {
    expect(parseMessageStatusGroup(undefined)).toBeUndefined();
    expect(parseMessageStatusGroup("active")).toBe("active");
    expect(parseMessageStatusGroup("delivered")).toBe("delivered");
    expect(parseMessageStatusGroup("failed")).toBe("failed");
  });

  it("rejects raw lifecycle states that are not filter groups", () => {
    expect(() => parseMessageStatusGroup("undelivered")).toThrowError();
  });
});
