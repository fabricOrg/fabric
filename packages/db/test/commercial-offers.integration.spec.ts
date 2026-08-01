import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "commercial-offers gate requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh isolated DB)",
  );
}

const owner = postgres(SUPER_URL, { max: 1 });
const runtime = postgres(APP_URL, { max: 1 });

const BOOK_ID = randomUUID();
const OFFER_ID = randomUUID();
const DRAFT_VERSION_ID = randomUUID();
const PUBLISHED_VERSION_ID = randomUUID();
const CREATOR_ID = randomUUID();
const APPROVER_ID = randomUUID();

async function cleanup() {
  await owner`DELETE FROM pricing_offer_versions
    WHERE id IN (${DRAFT_VERSION_ID}, ${PUBLISHED_VERSION_ID})`;
  await owner`DELETE FROM pricing_offers WHERE id = ${OFFER_ID}`;
  await owner`DELETE FROM price_books WHERE id = ${BOOK_ID}`;
  await owner`DELETE FROM staff_users
    WHERE id IN (${CREATOR_ID}, ${APPROVER_ID})`;
  await owner`DELETE FROM commercial_offer_channels
    WHERE code = 'voice' AND unit_code = 'second'`;
}

describe("channel-agnostic commercial offer invariants", () => {
  beforeAll(async () => {
    await cleanup();
    await owner`INSERT INTO staff_users (id, email, role)
      VALUES
        (${CREATOR_ID}, ${`offer-creator-${CREATOR_ID}@example.com`}, 'admin'),
        (${APPROVER_ID}, ${`offer-approver-${APPROVER_ID}@example.com`}, 'admin')`;
    await owner`INSERT INTO price_books (id, name, mode)
      VALUES (${BOOK_ID}, ${`Offer test ${BOOK_ID}`}, 'token')`;
    await owner`INSERT INTO commercial_offer_channels
      (code, unit_code, display_name, unit_label, is_active)
      VALUES ('voice', 'second', 'Voice', 'second', false)`;
    await owner`INSERT INTO pricing_offers
      (id, price_book_id, code, name, channel_code, unit_code)
      VALUES (
        ${OFFER_ID}, ${BOOK_ID}, 'voice-hour', 'Voice hour', 'voice', 'second'
      )`;
  });

  afterAll(async () => {
    await cleanup();
    await runtime.end();
    await owner.end();
  });

  it("seeds current channels and registers a future channel without a schema change", async () => {
    const rows = await owner<{ code: string; unit_code: string }[]>`
      SELECT code, unit_code
      FROM commercial_offer_channels
      WHERE (code = 'sms' AND unit_code = 'segment')
         OR (code = 'email' AND unit_code = 'recipient')
         OR (code = 'voice' AND unit_code = 'second')
      ORDER BY code`;

    expect(rows).toEqual([
      { code: "email", unit_code: "recipient" },
      { code: "sms", unit_code: "segment" },
      { code: "voice", unit_code: "second" },
    ]);
  });

  it("does not hard-code token accounting tables to today's channels", async () => {
    const constraints = await owner<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conname IN (
        'token_purchases_channel_chk',
        'token_lots_channel_chk',
        'token_counters_channel_chk',
        'token_holds_channel_chk'
      )`;
    expect(constraints).toEqual([]);
  });

  it("stores an indivisible fixed total without a rounded unit price", async () => {
    await owner`INSERT INTO pricing_offer_versions (
      id, offer_id, version, currency, paid_units, total_units,
      total_price_minor, created_by
    ) VALUES (
      ${DRAFT_VERSION_ID}, ${OFFER_ID}, 1, 'GHS', 200, 200, 300, ${CREATOR_ID}
    )`;

    const [row] = await owner<
      {
        paid_units: string;
        total_price_minor: string;
        has_unit_price: boolean;
      }[]
    >`
      SELECT
        paid_units::text,
        total_price_minor::text,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pricing_offer_versions'
            AND column_name = 'unit_price_minor'
        ) AS has_unit_price
      FROM pricing_offer_versions
      WHERE id = ${DRAFT_VERSION_ID}`;

    expect(row).toEqual({
      paid_units: "200",
      total_price_minor: "300",
      has_unit_price: false,
    });
  });

  it("rejects quantity totals that do not equal paid plus bonus units", async () => {
    await expect(
      owner`INSERT INTO pricing_offer_versions (
        offer_id, version, currency, paid_units, bonus_units, total_units,
        total_price_minor, created_by
      ) VALUES (
        ${OFFER_ID}, 2, 'GHS', 100, 20, 100, 300, ${CREATOR_ID}
      )`,
    ).rejects.toThrow(/pricing_offer_versions_total_units_chk/);
  });

  it("requires a second staff actor and cost evidence before publication", async () => {
    await expect(
      owner`INSERT INTO pricing_offer_versions (
        offer_id, version, status, currency, paid_units, total_units,
        total_price_minor, created_by, approved_by, approved_at, cost_snapshot
      ) VALUES (
        ${OFFER_ID}, 2, 'published', 'GHS', 200, 200, 300,
        ${CREATOR_ID}, ${CREATOR_ID}, now(),
        ${owner.json({
          estimatedCostMinor: "200",
          worstCaseCostMinor: "220",
          expectedMarginMinor: "80",
          minimumMarginBps: 2_000,
          calculatedAt: "2026-07-30T00:00:00.000Z",
          sourceReferences: ["test"],
        })}
      )`,
    ).rejects.toThrow(/pricing_offer_versions_approval_chk/);
  });

  it("does not allow a draft to skip publication and start or become retired", async () => {
    await expect(
      owner`INSERT INTO pricing_offer_versions (
        offer_id, version, status, currency, paid_units, total_units,
        total_price_minor, created_by, approved_by, approved_at, cost_snapshot
      ) VALUES (
        ${OFFER_ID}, 3, 'retired', 'GHS', 200, 200, 300,
        ${CREATOR_ID}, ${APPROVER_ID}, now(),
        ${owner.json({
          estimatedCostMinor: "200",
          worstCaseCostMinor: "220",
          expectedMarginMinor: "80",
          minimumMarginBps: 2_000,
          calculatedAt: "2026-07-30T00:00:00.000Z",
          sourceReferences: ["test"],
        })}
      )`,
    ).rejects.toThrow(/cannot start retired/);

    await expect(
      owner`UPDATE pricing_offer_versions
        SET status = 'retired',
            approved_by = ${APPROVER_ID},
            approved_at = now(),
            cost_snapshot = ${owner.json({
              estimatedCostMinor: "200",
              worstCaseCostMinor: "220",
              expectedMarginMinor: "80",
              minimumMarginBps: 2_000,
              calculatedAt: "2026-07-30T00:00:00.000Z",
              sourceReferences: ["test"],
            })}
        WHERE id = ${DRAFT_VERSION_ID}`,
    ).rejects.toThrow(/draft pricing offer version cannot be retired/);
  });

  it("makes published financial terms immutable while allowing retirement", async () => {
    await owner`INSERT INTO pricing_offer_versions (
      id, offer_id, version, status, currency, paid_units, total_units,
      total_price_minor, created_by, approved_by, approved_at, cost_snapshot
    ) VALUES (
      ${PUBLISHED_VERSION_ID}, ${OFFER_ID}, 2, 'published', 'GHS', 200, 200, 300,
      ${CREATOR_ID}, ${APPROVER_ID}, now(),
      ${owner.json({
        estimatedCostMinor: "200",
        worstCaseCostMinor: "220",
        expectedMarginMinor: "80",
        minimumMarginBps: 2_000,
        calculatedAt: "2026-07-30T00:00:00.000Z",
        sourceReferences: ["test"],
      })}
    )`;

    await expect(
      owner`UPDATE pricing_offer_versions
        SET total_price_minor = 301, updated_at = now()
        WHERE id = ${PUBLISHED_VERSION_ID}`,
    ).rejects.toThrow(/published pricing offer versions are immutable/);

    await owner`UPDATE pricing_offer_versions
      SET status = 'retired', updated_at = now()
      WHERE id = ${PUBLISHED_VERSION_ID}`;

    await expect(
      owner`UPDATE pricing_offer_versions
        SET total_price_minor = 302
        WHERE id = ${PUBLISHED_VERSION_ID}`,
    ).rejects.toThrow(/retired pricing offer versions are immutable/);
  });

  it("denies direct catalog access to the tenant runtime role", async () => {
    await expect(
      runtime`SELECT id FROM pricing_offers LIMIT 1`,
    ).rejects.toThrow(/permission denied/);
  });
});
