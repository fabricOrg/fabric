import {
  type GlJournalSpec,
  ledgerAccountKindSchema,
  type SubledgerPostingEvent,
} from "@app/contracts";
import { describe, expect, it } from "vitest";
import {
  accountingDateFromEventTime,
  deriveJournalFromSubledgerEvent,
  deriveReversalJournal,
  netMinor,
  SUBLEDGER_KIND_TO_GL_ACCOUNT,
} from "../src/general-ledger-postings.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TXN = "22222222-2222-4222-8222-222222222222";

function event(
  legs: SubledgerPostingEvent["legs"],
  overrides: Partial<SubledgerPostingEvent> = {},
): SubledgerPostingEvent {
  return {
    ledger_txn_id: TXN,
    currency: "GHS",
    event_time: "2026-07-30T10:15:00.000Z",
    tenant_id: TENANT,
    legs,
    ...overrides,
  };
}

/** The debit/credit account-code pair of a two-line journal, for matrix assertions. */
function pair(journal: GlJournalSpec): { debit: string; credit: string } {
  const debit = journal.lines.find((l) => l.direction === "debit");
  const credit = journal.lines.find((l) => l.direction === "credit");
  return {
    debit: debit?.account_code ?? "",
    credit: credit?.account_code ?? "",
  };
}

describe("subledger kind to GL account mapping", () => {
  it("covers every subledger account kind", () => {
    const mapped = Object.keys(SUBLEDGER_KIND_TO_GL_ACCOUNT).sort();
    expect(mapped).toEqual([...ledgerAccountKindSchema.options].sort());
  });

  it("nominates a distinct control account per kind", () => {
    const codes = Object.values(SUBLEDGER_KIND_TO_GL_ACCOUNT);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("the ADR-0013 posting matrix", () => {
  // Each case pins one row of the matrix in ADR-0013 #5 to executable code, so the document and the
  // books cannot drift apart silently.
  const cases: ReadonlyArray<{
    name: string;
    legs: SubledgerPostingEvent["legs"];
    debit: string;
    credit: string;
  }> = [
    {
      name: "wallet top-up clears",
      legs: [
        {
          account_kind: "gateway_clearing",
          direction: "debit",
          amount_minor: "5000",
        },
        { account_kind: "customer", direction: "credit", amount_minor: "5000" },
      ],
      debit: "1100",
      credit: "2100",
    },
    {
      name: "wallet send reserved",
      legs: [
        { account_kind: "customer", direction: "debit", amount_minor: "300" },
        {
          account_kind: "reserved_clearing",
          direction: "credit",
          amount_minor: "300",
        },
      ],
      debit: "2100",
      credit: "2110",
    },
    {
      name: "wallet send delivered",
      legs: [
        {
          account_kind: "reserved_clearing",
          direction: "debit",
          amount_minor: "300",
        },
        { account_kind: "revenue", direction: "credit", amount_minor: "300" },
      ],
      debit: "2110",
      credit: "4100",
    },
    {
      name: "wallet send fails",
      legs: [
        {
          account_kind: "reserved_clearing",
          direction: "debit",
          amount_minor: "300",
        },
        { account_kind: "customer", direction: "credit", amount_minor: "300" },
      ],
      debit: "2110",
      credit: "2100",
    },
    {
      name: "prepaid purchase clears",
      legs: [
        {
          account_kind: "gateway_clearing",
          direction: "debit",
          amount_minor: "30000",
        },
        {
          account_kind: "token_deferred_revenue",
          direction: "credit",
          amount_minor: "30000",
        },
      ],
      debit: "1100",
      credit: "2200",
    },
    {
      name: "prepaid unit delivered",
      legs: [
        {
          account_kind: "token_deferred_revenue",
          direction: "debit",
          amount_minor: "2",
        },
        { account_kind: "revenue", direction: "credit", amount_minor: "2" },
      ],
      debit: "2200",
      credit: "4100",
    },
  ];

  for (const c of cases) {
    it(`posts ${c.name} as DR ${c.debit} / CR ${c.credit}`, () => {
      expect(pair(deriveJournalFromSubledgerEvent(event(c.legs)))).toEqual({
        debit: c.debit,
        credit: c.credit,
      });
    });
  }
});

describe("deriveJournalFromSubledgerEvent", () => {
  const topUp: SubledgerPostingEvent["legs"] = [
    {
      account_kind: "gateway_clearing",
      direction: "debit",
      amount_minor: "5000",
    },
    { account_kind: "customer", direction: "credit", amount_minor: "5000" },
  ];

  it("keys the journal on the subledger transaction so a replay posts once", () => {
    const journal = deriveJournalFromSubledgerEvent(event(topUp));
    expect(journal.idempotency_key).toBe(`ledger_txn:${TXN}`);
    expect(journal.source_kind).toBe("ledger_txn");
    expect(journal.source_ref).toBe(TXN);
  });

  it("carries the tenant dimension onto every line without claiming tenancy", () => {
    const journal = deriveJournalFromSubledgerEvent(event(topUp));
    expect(journal.lines.every((l) => l.tenant_id === TENANT)).toBe(true);
    expect(journal.lines.every((l) => l.channel === undefined)).toBe(true);
  });

  it("carries the channel dimension when the movement is channel-specific", () => {
    const journal = deriveJournalFromSubledgerEvent(
      event(
        [
          {
            account_kind: "reserved_clearing",
            direction: "debit",
            amount_minor: "300",
          },
          { account_kind: "revenue", direction: "credit", amount_minor: "300" },
        ],
        { channel: "sms" },
      ),
    );
    expect(journal.lines.every((l) => l.channel === "sms")).toBe(true);
  });

  it("preserves balance for every multi-leg partition of an amount", () => {
    // A mirrored movement balances exactly when the movement it mirrors did. Walk many splits of a
    // credit against a single debit to show the property holds beyond the simple two-leg case.
    for (let split = 1n; split < 50n; split += 1n) {
      const total = 5000n;
      const legs: SubledgerPostingEvent["legs"] = [
        {
          account_kind: "gateway_clearing",
          direction: "debit",
          amount_minor: total.toString(),
        },
        {
          account_kind: "customer",
          direction: "credit",
          amount_minor: split.toString(),
        },
        {
          account_kind: "token_deferred_revenue",
          direction: "credit",
          amount_minor: (total - split).toString(),
        },
      ];
      expect(netMinor(deriveJournalFromSubledgerEvent(event(legs)).lines)).toBe(
        0n,
      );
    }
  });

  it("refuses to mirror an unbalanced movement", () => {
    expect(() =>
      deriveJournalFromSubledgerEvent(
        event([
          {
            account_kind: "gateway_clearing",
            direction: "debit",
            amount_minor: "5000",
          },
          {
            account_kind: "customer",
            direction: "credit",
            amount_minor: "4999",
          },
        ]),
      ),
    ).toThrow(/does not balance/);
  });
});

describe("accountingDateFromEventTime", () => {
  it("uses the UTC date, not the offset's local date", () => {
    // 2026-07-31T00:30+02:00 is 2026-07-30T22:30Z — the period is July, not August.
    expect(accountingDateFromEventTime("2026-07-31T00:30:00+02:00")).toBe(
      "2026-07-30",
    );
  });

  it("keeps a UTC instant on its own date", () => {
    expect(accountingDateFromEventTime("2026-07-30T23:59:59.999Z")).toBe(
      "2026-07-30",
    );
  });

  it("rejects an unparseable timestamp rather than posting to a wrong period", () => {
    expect(() => accountingDateFromEventTime("not-a-time")).toThrow(RangeError);
  });
});

describe("deriveReversalJournal", () => {
  const original = deriveJournalFromSubledgerEvent(
    event([
      {
        account_kind: "reserved_clearing",
        direction: "debit",
        amount_minor: "300",
      },
      { account_kind: "revenue", direction: "credit", amount_minor: "300" },
    ]),
  );
  const journalId = "33333333-3333-4333-8333-333333333333";
  const reversal = deriveReversalJournal({
    original,
    originalJournalId: journalId,
    eventTimeIso: "2026-08-02T09:00:00.000Z",
    memo: "provider disputed the delivery",
  });

  it("flips every direction and keeps every amount and account", () => {
    expect(reversal.lines).toEqual(
      original.lines.map((l) => ({
        ...l,
        direction: l.direction === "credit" ? "debit" : "credit",
      })),
    );
  });

  it("nets to zero against the journal it reverses", () => {
    expect(netMinor([...original.lines, ...reversal.lines])).toBe(0n);
  });

  it("keys off the original so a retried correction cannot double-reverse", () => {
    expect(reversal.idempotency_key).toBe(`reversal:${journalId}`);
    expect(reversal.source_kind).toBe("reversal");
    expect(reversal.source_ref).toBe(journalId);
  });

  it("keys every journal as {source_kind}:{source_ref}, reversals included", () => {
    // That rule is what makes a key reconstructible from the stored columns, so a poster can ask
    // "have I already posted this?" instead of discovering it as a constraint violation.
    for (const j of [original, reversal]) {
      expect(j.idempotency_key).toBe(`${j.source_kind}:${j.source_ref}`);
    }
  });

  it("dates the correction when it happened, not when the original did", () => {
    expect(reversal.accounting_date).toBe("2026-08-02");
    expect(original.accounting_date).toBe("2026-07-30");
  });

  it("reverses a reversal back to the original directions", () => {
    const restored = deriveReversalJournal({
      original: reversal,
      originalJournalId: "44444444-4444-4444-8444-444444444444",
      eventTimeIso: "2026-08-03T09:00:00.000Z",
      memo: "dispute withdrawn",
    });
    expect(restored.lines.map((l) => l.direction)).toEqual(
      original.lines.map((l) => l.direction),
    );
  });
});
