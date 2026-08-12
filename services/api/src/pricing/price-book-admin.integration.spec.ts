import { randomUUID } from "node:crypto";
import type { Currency, PriceBookRateDto } from "@app/contracts";
import {
  accounts,
  auditEvents,
  createProvisioningDb,
  priceBooks,
  priceBookVersions,
  pricingSellRules,
} from "@app/db";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { PriceBookAdminService } from "./price-book-admin.service.js";
import { PricingService } from "./pricing.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

const actor = { email: "ops@fabric.dev", staffId: null };
const DEFAULT_BOOK_NAME = "Subscription — Standard";

/**
 * Real-Postgres coverage for the ADR-0010 slice-3 admin write surface: create/update a book, assign
 * it to an account and see the send-path resolver reflect the change, the one-default-per-mode
 * invariant, the DB-level `> 0` money floor, and audit records.
 */
describeDb("price-book admin", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const pricing = new PricingService(db);
  const admin = new PriceBookAdminService(db, new AuditService(db), pricing);

  const bookIds: string[] = [];
  const accountIds: string[] = [];

  async function makeAccount(): Promise<string> {
    const id = randomUUID();
    await db.db
      .insert(accounts)
      .values({ id: id as never, name: "Admin test", slug: `pba-${id}` });
    accountIds.push(id);
    return id;
  }

  function req(
    // `Currency`, not `string`: the upsert request now only accepts a currency the platform can
    // settle, so the fixture has to be as narrow as the contract it feeds.
    rates: {
      channel: PriceBookRateDto["channel"];
      currency: Currency;
      p: string;
    }[],
  ) {
    return {
      name: `Book — ${randomUUID()}`,
      mode: "subscription" as const,
      description: "",
      is_default: false,
      is_public: false,
      rates: rates.map((r) => ({
        channel: r.channel,
        currency: r.currency,
        unit_price_minor: r.p,
      })),
    };
  }

  afterAll(async () => {
    for (const id of accountIds) {
      await db.db.delete(accounts).where(eq(accounts.id, id as never));
    }
    const versions =
      bookIds.length > 0
        ? await db.db
            .select({ id: priceBookVersions.id })
            .from(priceBookVersions)
            .where(inArray(priceBookVersions.priceBookId, bookIds))
        : [];
    if (versions.length > 0) {
      const versionIds = versions.map((version) => version.id);
      await db.db
        .delete(pricingSellRules)
        .where(inArray(pricingSellRules.versionId, versionIds));
      await db.db
        .delete(priceBookVersions)
        .where(inArray(priceBookVersions.id, versionIds));
    }
    for (const id of bookIds) {
      await db.db.delete(priceBooks).where(eq(priceBooks.id, id));
    }
    await db.db
      .delete(auditEvents)
      .where(like(auditEvents.action, "price_book.%"));
    await db.end();
  });

  it("creates a book, lists it alongside the seeded default", async () => {
    const created = await admin.upsertBook(
      null,
      req([{ channel: "sms", currency: "GHS", p: "7" }]),
      actor,
    );
    expect(created).not.toBeNull();
    if (created) bookIds.push(created.id);
    expect(created?.rates).toEqual([
      { channel: "sms", currency: "GHS", unit_price_minor: "7" },
    ]);

    const books = await admin.listBooks();
    expect(books.some((b) => b.name === DEFAULT_BOOK_NAME)).toBe(true);
    expect(books.some((b) => b.id === created?.id)).toBe(true);
  });

  // A WhatsApp rate was written to pricing_sell_rules as unit_basis 'recipient' by a two-way
  // ternary, which pricing_sell_rules_basis_chk rejects — the transaction rolled back and the admin
  // console showed an opaque 500. Email is asserted in the same book because the storage vocabulary
  // ('recipient') differs from the quoted one ('send'), so a fix that collapses the two maps passes
  // for WhatsApp and breaks email.
  it("stores the right unit basis per channel, including WhatsApp", async () => {
    const created = await admin.upsertBook(
      null,
      req([
        { channel: "whatsapp", currency: "GHS", p: "400" },
        { channel: "email", currency: "GHS", p: "9" },
        { channel: "sms", currency: "GHS", p: "7" },
      ]),
      actor,
    );
    expect(created).not.toBeNull();
    if (created) bookIds.push(created.id);

    const rules = await db.db.execute(sql`
      SELECT r.channel, r.unit_basis
      FROM pricing_sell_rules r
      JOIN price_book_versions v ON v.id = r.version_id
      WHERE v.price_book_id = ${created?.id}
      ORDER BY r.channel`);
    expect(rules).toEqual([
      { channel: "email", unit_basis: "recipient" },
      { channel: "sms", unit_basis: "segment" },
      { channel: "whatsapp", unit_basis: "message" },
    ]);
  });

  it("assign → resolver prices on the book; a rate edit reprices (cache cleared); both audited", async () => {
    const book = await admin.upsertBook(
      null,
      req([
        { channel: "sms", currency: "GHS", p: "7" },
        { channel: "email", currency: "GHS", p: "9" },
      ]),
      actor,
    );
    if (!book) throw new Error("book not created");
    bookIds.push(book.id);
    const accountId = await makeAccount();

    expect(await admin.assignAccount(accountId, book.id, actor)).toBe("ok");
    expect((await pricing.resolveRates(accountId)).sms.GHS).toBe(7n);

    // Re-price the book; the resolver cache is cleared on upsert, so the next read sees it.
    await admin.upsertBook(
      book.id,
      req([
        { channel: "sms", currency: "GHS", p: "11" },
        { channel: "email", currency: "GHS", p: "9" },
      ]),
      actor,
    );
    expect((await pricing.resolveRates(accountId)).sms.GHS).toBe(11n);

    const assignRows = await db.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "price_book.assign"),
          eq(auditEvents.targetId, accountId),
        ),
      );
    expect(assignRows.length).toBe(1);
  });

  it("enforces one default per mode — a new default clears the old", async () => {
    // Uses the `token` mode so it never touches the shared `subscription` default the resolver (and
    // concurrent specs) read — the partial-unique invariant is mode-scoped, so this is equivalent.
    const tokenSpec = (extra: object) => ({
      name: `Token — ${randomUUID()}`,
      mode: "token" as const,
      description: "",
      is_default: false,
      is_public: false,
      rates: [
        {
          channel: "sms" as const,
          currency: "GHS" as Currency,
          unit_price_minor: "8",
        },
      ],
      ...extra,
    });
    const first = await admin.upsertBook(
      null,
      tokenSpec({ is_default: true }),
      actor,
    );
    const second = await admin.upsertBook(
      null,
      tokenSpec({ is_default: true }),
      actor,
    );
    if (!first || !second) throw new Error("token books not created");
    bookIds.push(first.id, second.id);

    const defaults = await db.db
      .select({ id: priceBooks.id })
      .from(priceBooks)
      .where(and(eq(priceBooks.mode, "token"), eq(priceBooks.isDefault, true)));
    expect(defaults.length).toBe(1);
    expect(defaults[0]?.id).toBe(second.id);
  });

  it("publishes only one sanitized public price snapshot", async () => {
    const firstRequest = req([
      { channel: "sms", currency: "GHS", p: "7" },
      { channel: "email", currency: "GHS", p: "9" },
    ]);
    const first = await admin.upsertBook(
      null,
      { ...firstRequest, is_public: true },
      actor,
    );
    const secondRequest = req([
      { channel: "sms", currency: "GHS", p: "11" },
      { channel: "email", currency: "GHS", p: "13" },
    ]);
    const second = await admin.upsertBook(
      null,
      { ...secondRequest, is_public: true },
      actor,
    );
    if (!first || !second) throw new Error("public books not created");
    bookIds.push(first.id, second.id);

    const published = await admin.publicPricing();
    expect(published?.rates).toEqual([
      {
        channel: "email",
        currency: "GHS",
        unit_price_minor: "13",
        unit_basis: "send",
      },
      {
        channel: "sms",
        currency: "GHS",
        unit_price_minor: "11",
        unit_basis: "segment",
      },
    ]);
    expect(published).not.toHaveProperty("id");
    expect(published).not.toHaveProperty("name");
  });

  it("rejects a zero unit price at the DB layer (money floor)", async () => {
    await expect(
      admin.upsertBook(
        null,
        req([{ channel: "sms", currency: "GHS", p: "0" }]),
        actor,
      ),
    ).rejects.toThrow();
  });

  it("distinguishes unknown book from unknown account on write/assign", async () => {
    const publishedBefore = await admin.publicPricing();
    expect(
      await admin.upsertBook(
        randomUUID(),
        {
          ...req([
            { channel: "sms", currency: "GHS", p: "5" },
            { channel: "email", currency: "GHS", p: "7" },
          ]),
          is_public: true,
        },
        actor,
      ),
    ).toBeNull();
    expect(await admin.publicPricing()).toEqual(publishedBefore);
    // Unknown account → account_not_found; a valid-but-unknown book id → book_not_found (not an FK 500).
    expect(await admin.assignAccount(randomUUID(), null, actor)).toBe(
      "account_not_found",
    );
    const accountId = await makeAccount();
    expect(await admin.assignAccount(accountId, randomUUID(), actor)).toBe(
      "book_not_found",
    );
  });
});
