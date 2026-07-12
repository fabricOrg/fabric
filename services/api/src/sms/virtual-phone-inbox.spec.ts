import type { AppDb } from "@app/db";
import { describe, expect, it } from "vitest";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import { listVirtualInbox } from "./virtual-phone-inbox.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const SUBJECT = "00000000-0000-4000-8000-000000000002";
const BODY = "00000000-0000-4000-8000-000000000003";

function row(index: number) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const timestamp = `2026-07-12 21:00:0${9 - index}.123456+00`;
  return {
    id,
    sender_id: "SANDBOX",
    status: "delivered",
    segments: 1,
    created_at: timestamp,
    sort_cursor: timestamp,
    subject_id: SUBJECT,
    body_pii_id: BODY,
    read_at: null,
    legacy: false,
    direction: "outbound",
  };
}

function vault(subject: string | null = SUBJECT): PiiVaultService {
  return {
    findSubjectForPhone: async () => subject,
    readMany: async () => new Map([[BODY, "hello"]]),
    readPhones: async () => new Map([[SUBJECT, "+233545227189"]]),
  } as unknown as PiiVaultService;
}

function db(
  pages: ReadonlyArray<ReadonlyArray<ReturnType<typeof row>>>,
): AppDb {
  let index = 0;
  return {
    withTenant: async () => pages[index++] ?? [],
  } as unknown as AppDb;
}

describe("Virtual Phone inbox pagination", () => {
  it("emits an exact-precision cursor and resumes without duplicates", async () => {
    const database = db([
      [row(1), row(2), row(3)],
      [row(3), row(4)],
    ]);
    const first = await listVirtualInbox({
      db: database,
      vault: vault(),
      tenantId: TENANT,
      virtualNumber: "+999123456789",
      retentionDays: 30,
      limit: 2,
    });
    expect(first.messages.map((message) => message.id)).toEqual([
      row(1).id,
      row(2).id,
    ]);
    expect(first.next_cursor).toBeTruthy();

    const second = await listVirtualInbox({
      db: database,
      vault: vault(),
      tenantId: TENANT,
      virtualNumber: "+999123456789",
      retentionDays: 30,
      limit: 2,
      ...(first.next_cursor ? { cursor: first.next_cursor } : {}),
    });
    const seen = [...first.messages, ...second.messages].map(
      (message) => message.id,
    );
    expect(new Set(seen).size).toBe(seen.length);
    expect(second.next_cursor).toBeNull();
  });

  it("returns an honest empty page when an exact recipient is absent", async () => {
    const result = await listVirtualInbox({
      db: db([]),
      vault: vault(null),
      tenantId: TENANT,
      virtualNumber: "+999123456789",
      retentionDays: 30,
      recipient: "+233500000000",
    });
    expect(result.messages).toEqual([]);
    expect(result.next_cursor).toBeNull();
  });
});
