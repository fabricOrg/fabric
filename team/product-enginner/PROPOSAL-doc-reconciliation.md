# PROPOSAL — PI-1 doc reconciliation (BACKLOG ↔ README) + canonical status/commit-point

**Author:** product-engineers/pascal · **Date:** 2026-07-01 · **Session:** app-arch-reassessment
**Status:** PROPOSAL ONLY — no canonical doc edited. Awaiting @fifi review; §5 (status enum) awaiting @newton sign-off.
**Binds to:** `ledger-double-entry` v1.0.0 (newton), F3.x ACs, PRE-IMPLEMENTATION-REVIEW B1.

Scope from the assigned lane (a–d):
- (a) Make `docs/PI-1-BACKLOG.md` and `docs/PI-1/README.md` agree on the feature set + numbering.
- (b) Resolve the F6.2 numbering collision + the vanished Verify success-pricing SKU.
- (c) Decide F5.7 / F4.3 / F8.7 / F1.6 (and F2.2) in/out of the **thin thread**.
- (d) Pin ONE canonical message-status enum + the commit-point (with newton).

---

## 1. The drift (evidence)

The BACKLOG is the "research-grounded" master; the README story-index was written later and **added
features + repurposed a number** that were never back-ported. Feature sets today:

| Epic | In BACKLOG only | In README only | Meaning conflict |
|---|---|---|---|
| E1 | — | **F1.6** Platform notifications (transactional) | — |
| E4 | — | **F4.3** Payment reconciliation & reversals | — |
| E5 | — | **F5.7** Inbound message ingestion (MO) | — |
| E6 | F6.2 = *Success-based pricing* | F6.2 = *OTP body redaction* | **F6.2 means two different things** |
| E6 | F6.3 = MUST-**basic** | F6.3 = **MUST** | priority mismatch |
| E8 | — | **F8.7** Rate limiting & quotas | — |

Consequence (confirmed by adams): the billing/status test suite can't be written against a status
enum + billing rules two docs disagree on; and the **Verify success-based pricing SKU** — the doc's
own "5–7× margin" headline — has **no story file** and silently fell out of the committed set.

---

## 2. Resolution (a) + (c) — enumerate the orphans, decide thin-thread membership

**Rule applied:** the README's added features are real and should be *enumerated in the BACKLOG*
(single source of feature truth), but only the ones the 9-step demo actually needs stay in the
**thin thread**; the rest are MUST-in-PI-1 but **post-thread / slip-first (PI-1.5)**.

| Feature | Enumerate in BACKLOG? | Thin thread? | Rationale |
|---|---|---|---|
| **F5.7** Inbound MO | **Yes**, add to E5 (MUST) | **IN** | STOP/opt-out (F7.2, in-thread) needs an inbound path to receive STOP. Already in README thread. |
| **F4.3** Payment reconciliation & reversals | **Yes**, add to E4 (MUST) | **IN** | Top-up correctness = money-correctness (B8 double-credit, reversals). Already in README thread. |
| **F8.7** Rate limiting & quotas | **Yes**, add to E8 (MUST) | **OUT** → PI-1.5 | 9-step demo doesn't need it; any real API exposure does. Ties to S7 (atomic token bucket). |
| **F1.6** Platform notifications (transactional) | **Yes**, add to E1 (MUST) | **OUT** → PI-1.5 | Underpins F3.7 low-balance alert (itself slip-first). Not on the demo path. |
| **F2.2** Staff identity + admin RBAC | already in both | **ADD to thread** | **Dependency fix:** thread has F9.4 (maker-checker wallet adjust) which needs ≥2 staff roles. WALKING-SKELETON step-0 already lists "staff-iam" as foundational. Minimal cut: staff org + 2 roles (maker/checker). |

**Net thin-thread change:** `+F2.2`. F5.7/F4.3 already in; F8.7/F1.6 explicitly OUT (documented, not silently dropped).

---

## 3. Resolution (b) — E6 renumber (minimal-churn) + restore the success-pricing SKU

Keeps every existing README story-file number stable (F6.1/F6.2/F6.3 files unchanged); only the
PI-2 channel-fallback reference moves.

| New | Feature | Priority | Note |
|---|---|---|---|
| **F6.1** | Managed Verify (start/check, expiry, attempt-limit) | MUST · **in thread** | unchanged (both docs agree) |
| **F6.2** | OTP body redaction (auto-redact codes in stored bodies) | MUST | README meaning kept; genuine safety feature; story file `F6.2-otp-body-redaction.md` stays valid |
| **F6.3** | SMS-pumping / Fraud-Guard protection | **MUST-basic** | reconcile to BACKLOG's nuance: prefix-anomaly block on-by-default; full analytics PI-2 |
| **F6.4** | **Verify success-based pricing** *(RESTORED)* | **Seam in PI-1 · full billing PI-1.5** | per fifi: the Verify txn is a **distinct ledger category** from raw SMS in PI-1 (the seam), so success-pricing is additive later — no reprice migration |
| **F6.5** | Channel fallback (SMS→voice→WhatsApp) | PI-2 | renumbered from old F6.4 |

**F6.4 seam AC (must land in PI-1 so PI-1.5 is additive):** a Verify charge posts to the ledger
with its own `reason`/usage-category (e.g. `verify`) distinct from `sms_commit`, and the Verify txn
records the *verification outcome* (success/fail) — even though PI-1 bills per-SMS. PI-1.5 flips the
rate to per-successful-verification with **zero schema change**.

---

## 4. Exact diffs (proposed — apply only after review)

### 4a. `docs/PI-1-BACKLOG.md`

**E1** — add row after F1.5:
```
| 1.6 | **Platform notifications** (transactional: low-balance, sender-ID approved, DSR receipts) | MUST (post-thread) | Underpins F3.7. *Value: operational + customer comms on the money/compliance path.* |
```

**E4** — add after F4.2:
```
- **F4.3 Payment reconciliation & reversals** `[MUST]` — reconcile PSP settlement vs credited top-ups;
  handle chargebacks/reversals as compensating ledger entries (never edit history).
  - *AC:* a reversed/failed-after-credit top-up posts a compensating debit; ledger stays balanced.
  - *Evidence/Value:* Paystack/Flutterwave webhooks incl. reversal events. No orphaned credits.
```

**E5** — add after F5.6:
```
- **F5.7 Inbound message ingestion (MO)** `[MUST]` — receive inbound SMS (incl. STOP/START/HELP);
  normalize → resolve subject_id → route to opt-out engine (F7.2) + tenant inbound webhook.
  - *Evidence/Value:* prerequisite for F7.2 STOP handling. In the thin thread.
```

**E6** — replace the F6.2/F6.3/F6.4 lines with the §3 table (F6.1 unchanged; F6.2 = body redaction;
F6.3 = pumping MUST-basic; **F6.4 = success-based pricing, seam PI-1 / full PI-1.5**; F6.5 = channel fallback PI-2).

**E8** — add after F8.6:
```
- **F8.7 Rate limiting & quotas** `[MUST — post-thread]` — per-key/per-tenant token-bucket limits;
  429 + Retry-After; atomic (single Redis Lua script, see PRE-IMPL S7) so bursts can't bypass fraud controls.
  - *Value:* abuse/cost protection; prerequisite for public exposure (not for the demo).
```

**"Out of scope" / sequencing note** — add: "F8.7, F1.6, F6.4-full are **MUST in PI-1 but post-thin-thread** (PI-1.5 slip-first)."

### 4b. `docs/PI-1/README.md`

- **Index E1:** F1.6 already listed — no change (now matches BACKLOG).
- **Index E6:** relabel per §3 (F6.2 body redaction, F6.3 pumping MUST-basic, **add F6.4 success-based pricing**, F6.5 channel fallback → move to the PI-2 deferred list line as `F6.5`).
- **Thin-thread line (§"Scope realism"):** insert `F2.2` (after `F2.1`). Add `F5.7`/`F4.3` are already present — no change.
- **Slip-first line:** add `F8.7`, `F1.6`, `F6.4-full` explicitly.
- **Deferred-to-PI-2 line:** change `channel-fallback OTP (F6.4)` → `(F6.5)`.

---

## 5. Resolution (d) — canonical message-status enum + commit-point  *(needs @newton sign-off)*

Fixes PRE-IMPL **B1** (no `accepted` state; `sent` ambiguous; commit-point undefined) and binds the
commit to newton's `ledger-double-entry` COMMIT leg (reserved_clearing → revenue).

**Canonical enum (every provider maps its raw statuses onto this):**
```
queued → sending → accepted → sent → delivered
                                    ↘ undelivered
                                    ↘ failed
```
- `queued` — reserved: wallet debited → `reserved_clearing` (newton RESERVE leg). Pre-provider.
- `sending` — handed to provider adapter; `provider_attempt` row + deterministic provider-idempotency
  key persisted **before** the network call (fixes B2).
- `accepted` — **provider acknowledged submission** (we hold a `provider_message_ref`). *New state.*
- `sent` — provider reports handed to carrier/MNO (some providers collapse `accepted`+`sent`).
- `delivered` / `undelivered` / `failed` — terminal DLR outcomes (+ canonical error codes).

**Commit-point rule (the pinned decision):**
> COMMIT (reserved_clearing → revenue) fires on the transition **into the first canonical status
> present in the provider's `billableStatuses` set** — **default `{accepted}`**. Providers that only
> bill on delivery set `billableStatuses = {delivered}`.
> - Guarded by the **B6 terminal resolution state machine** (`reserved → committed | refunded`,
>   `SELECT … FOR UPDATE` + compare-and-set, deterministic key `commit:{msgId}`).
> - A status in the provider's **platform-fault exemption list** (F3.5) → **REFUND**
>   (reserved_clearing → customer, key `refund:{msgId}`), never commit.
> - Reservation-sweeper (F3.3) → REFUND if no billable/terminal status within TTL (~60 min, S4).

This gives F3.5 a concrete hook, makes `sms_commit` a real movement (matches newton's model), and
lets adams write the billable-status suite against a fixed enum. **@newton: please confirm the commit
leg fires exactly on `enter(billableStatuses[0])` and that `accepted` is the right default.**

---

## 6. Downstream unblocks
- **adams** — billing/status tests now have a fixed enum + commit-point (§5) and a settled feature set (§2–4).
- **newton** — B1 canonical status + commit-point pinned to his COMMIT leg; F6.4 seam = a distinct usage-category on the ledger.
- **thin thread** — net change `+F2.2`; F8.7/F1.6/F6.4-full documented as post-thread (no silent truncation).

## 7. Open questions for @fifi
1. F6.3 priority: I reconciled to **MUST-basic** (BACKLOG). Confirm vs README's MUST.
2. F2.2-into-thread: add minimal staff-identity, OR keep F2.2 out and demo maker-checker with two pre-seeded staff accounts (no self-serve staff onboarding)? I recommend the minimal cut.
3. Sweeper TTL default (S4) — I assumed ~60 min in §5; confirm or defer to newton/adams.
