# Virtual Phone — Test Mode (inbound, faults, retention)

Follow-on to [`VIRTUAL-PHONE-DELIVERY.md`](./VIRTUAL-PHONE-DELIVERY.md), which landed the send path.
That slice made virtual delivery real; it did not make it a usable **test mode**. Today a virtual
send always succeeds, can never be replied to, and charges the tenant real money. This spec closes
those gaps.

---

## D1 — Virtual sends are credit-free (reserve, then refund)

`VirtualPhoneProvider.billableStatuses = ["accepted"]` and nothing zero-rates virtual, so the engine
commits the wallet debit exactly as it would for Arkesel. A live tenant who toggles to virtual to
test therefore burns real credits on messages that never leave the building. This contradicts
**E13-S3 AC1** ("test sends … don't debit real balance").

**Decision.** Keep the tx1 reservation identical to live, then **refund at the terminal delivery
event**. Net charge is zero and the ledger carries a balanced debit/credit pair per virtual message,
referenced to the message id and idempotent on `refund:{messageId}`.

Zero-rating (a zero `RateTable` on `deps("virtual")`) was rejected: it is simpler, but it removes the
insufficient-funds path from test mode. "No funds → no send" is exactly the failure a developer needs
to rehearse before going live, and the wallet path is the one place we deliberately **fail closed**.
Reserving for real keeps that behaviour honest; refunding keeps it free.

---

## D2 — Inbound is first-class

The virtual phone is send-only, so **STOP cannot be tested at all**. The DND opt-out engine (E10-S5)
is driven in the real world by an inbound STOP from the handset, which means the compliance feature
we already shipped has no end-to-end path a customer — or we — can exercise. This is the gap that
most undermines the feature.

**Decision.** The virtual handset can receive and reply.

- A reply from the dashboard handset posts to `/internal/tenants/:tenantId/virtual-phone/inbound`.
- It is persisted as a **canonical inbound message**, not a virtual-only toy: a new tenant-scoped
  `inbound_messages` table under FORCE RLS, written through the same path a real carrier MO webhook
  will use when Arkesel inbound lands. Virtual is one producer, not a parallel universe.
- Keyword handling (`STOP` / `START` / `HELP`, case-insensitive, whitespace-trimmed) runs on that
  pipeline and writes the consent opt-out with `source = 'stop_reply'` — so E10-S5 is exercised
  end to end, from handset reply to a subsequent promotional send being blocked.
- `message.received` and `contact.opted_out` are emitted **through the transactional outbox**, in the
  same transaction as the inbound write. A cross-boundary event a webhook must see never rides a
  fire-and-forget promise.

---

## D3 — Deterministic fault simulation (magic recipients)

`send()` always returns `accepted` and `delivered()` always returns `delivered`. Nothing can produce
a failure, so customers cannot exercise their own error handling, and our own "needs attention"
surfaces key off failures test mode can never generate.

**Decision.** Reserved recipient suffixes route to deterministic outcomes **in virtual mode only**;
live mode ignores them entirely and treats the number as an ordinary MSISDN.

| Recipient suffix | Outcome                                                        |
| ---------------- | -------------------------------------------------------------- |
| `0000`           | `undelivered` — carrier rejection, billable (no refund)          |
| `0001`           | `failed` — platform fault, refunded per `platformFaultExemptions` |
| `0002`           | `delivered`, but the DLR arrives after a delay (async rehearsal) |
| `0003`           | delivered, followed by an automatic inbound `STOP` (see D2)      |

The suffix table is documented in the dev-portal reference. Precedent: Stripe test cards; Twilio
magic numbers.

---

## D4 — Ciphertext resilience and key rotation

`list()` decrypts inside a `.map()` with no per-row guard and `decrypt()` throws on any malformed
value, so **one corrupt row 500s the entire inbox**. That becomes concrete on the first key rotation:
`decrypt()` only ever tries the current key, so rotating `VIRTUAL_PHONE_ENCRYPTION_KEY` silently
bricks every existing inbox row.

**Decision.**

- Guard the per-row decrypt. A row that will not decrypt renders as an explicit unreadable
  placeholder — a degraded message, never a failed inbox.
- `VIRTUAL_PHONE_ENCRYPTION_KEY` stays the write key. `VIRTUAL_PHONE_ENCRYPTION_KEYS_PREVIOUS`
  (comma-separated) is tried on **decrypt only**. New writes always use the primary.
- The `v1.` envelope prefix stays the format version; the AAD binding (`tenantId:messageId`) is
  unchanged — it is what stops a ciphertext being replayed across tenants and must keep a test.

---

## D5 — Retention and inbox reset

Recipient MSISDNs and message bodies are stored encrypted but **forever**: no TTL, no purge, no
clear-inbox control. `LIMIT 100` hides the growth in the UI; the rows remain. Encrypted personal data
is still personal data, and a bounded retention window is the expected posture under Ghana NCA / data
protection.

**Decision.**

- `virtual_deliveries` rows are purged after a retention window (default **30 days**, surfaced to the
  tenant) by the **existing scheduled maintenance job**. It already has a production caller — extend
  that caller rather than adding library-only code that never runs.
- Owner/Admin can "Clear virtual inbox" from the dashboard. Audited
  (`tenant.virtual_phone.inbox_cleared`).

---

## D6 — Pagination and honest search

`list()` is `LIMIT 100` with no pagination, and the page's search box filters only the rows already
loaded — so searching for a message beyond the newest 100 returns "no results" for a message that
exists. A silently wrong answer is worse than an empty state.

**Decision.**

- Cursor pagination on `(created_at, id)`, matching the existing index.
- A **recipient blind index** — `HMAC-SHA256(normalized_msisdn, key)` stored beside the ciphertext —
  gives exact-match recipient search server-side without decrypting anything.
- Body search stays client-side over the loaded page and is **labelled as such in the UI**. Full-text
  search over ciphertext is out of scope; we will not weaken the encryption to get it.

---

## Invariants (added to the delivery spec's set)

- Virtual delivery never contacts a carrier. *(unchanged)*
- **For any virtual message, the ledger nets to zero** — reserved, then refunded.
- Inbound is canonical: a virtual reply and a future carrier MO produce the same record and traverse
  the same pipeline.
- Fault simulation is virtual-only. A magic suffix in live mode is just a phone number.
- The inbox never fails wholesale on a single unreadable row.
- Consent state changed by an inbound STOP is authoritative — it blocks subsequent promotional sends
  in **both** modes.

---

## Acceptance slices

1. **Credit-free virtual** (D1) — a virtual send reserves, delivers, refunds; wallet nets zero;
   insufficient funds still blocks the send.
2. **Inbound + STOP** (D2) — handset reply persists a canonical inbound; `STOP` opts the recipient
   out; a following promotional send to that recipient is blocked.
3. **Fault simulation** (D3) — each magic suffix produces its documented terminal status, and the
   platform-fault case refunds.
4. **Decrypt resilience + rotation** (D4) — a bad row degrades to a placeholder; a rotated key still
   reads history via the previous-key list; a tampered AAD is rejected.
5. **Retention + clear inbox** (D5) — the maintenance job purges past the window; clear-inbox is
   audited.
6. **Pagination + blind-index search** (D6) — beyond 100 messages, paging works and recipient search
   finds an old message.

## Out of scope (tracked elsewhere)

Media assets, multiple virtual devices, and campaign canonicalization remain follow-ons of the
delivery spec. Full-text search over message bodies is explicitly not planned.
