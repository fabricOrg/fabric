# Ledger write-time enforcement — make the money invariants correct-by-construction

**Mandate (ratified by the human, non-negotiable):** *"If anything is not enforced at write-time, it
WILL eventually break under concurrency."* Three ledger invariants are currently **app-code + CI-checked
only** (the `balance_minor` schema comment literally says "checked continuously in CI"). This lane moves
them to **write-time DB enforcement** — a violating write is *rejected by the database*, not detected
after the fact.

**Owner:** newton (ledger schema/primitives) · **Gate:** adams · **Review:** fifi (money-critical).
**Sequence:** after newton's non-super-owner migration (`feature/ops-nonsuper-owner`) — and note it
**depends on** it: the enforcement must be verified against a **non-super owner** (a superuser bypasses
the very triggers we're adding), so the two land in order.

## Already write-time-enforced (do not regress) ✅
Cross-tenant isolation (RLS FORCE + WITH CHECK, B3-verified) · idempotency `UNIQUE(tenant,idempotency_key)`
+ fingerprint (B8) · commit-XOR-refund partial `UNIQUE` (B6) · atomicity (single tx) · entry immutability
(`REVOKE UPDATE/DELETE`) · debit-XOR-credit + `amount>0` · lost-update-safe balance (`balance = balance +
delta`, row-locked) · overdraw gate (`FOR UPDATE` + reject in `reserve`, S5).

## The three gaps → the fix (2 triggers)

### Trigger A — deferred per-transaction constraint (balance + currency)
`CONSTRAINT TRIGGER … AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED` → fires once at
`COMMIT` (so the app can insert legs incrementally within the tx). For each touched `txn_id`:
1. **Balanced:** `SUM(CASE direction WHEN 'credit' THEN amount_minor ELSE -amount_minor END) = 0` →
   else `RAISE EXCEPTION` (an unbalanced transaction **cannot commit**). Closes gap #1.
2. **Single currency:** join `ledger_entries → ledger_accounts`, assert `COUNT(DISTINCT currency) = 1`
   per txn → else raise. Closes gap #3 (#7 in the mandate). (Denormalizing `currency` onto the entry is
   optional; the join works since entries are append-only and complete at commit.)

### Trigger B — DB-maintained balance projection (immediate)
`TRIGGER … AFTER INSERT ON ledger_entries FOR EACH ROW` →
`UPDATE ledger_accounts SET balance_minor = balance_minor + <signed(amount,direction)>, version = version + 1
WHERE id = NEW.account_id`. The projection is now **maintained by the DB atomically with the entry** — it
**cannot drift** from the legs (closes gap #2; the adams harness-residue class becomes impossible).
- **Replaces the app's `moveBalance`** in `@app/wallet` — the wallet primitives stop calling `moveBalance`;
  the trigger owns the increment. `reserve` **keeps** its `FOR UPDATE` read + overdraw check (that gate
  runs *before* the leg insert); it just drops the explicit balance write.
- `version + 1` preserved so the optimistic-lock reads elsewhere still work.

## Acceptance criteria (adams — gate the ENFORCEMENT, not just happy paths)
The invariant gate must prove violations are **rejected at write-time**, on a **non-super owner** DB:
- **unbalanced txn** (insert one leg, or two unequal legs) → transaction **fails to commit** (`RAISE`), not
  "detected later". 
- **cross-currency txn** (legs against accounts of different currencies) → **rejected**.
- **projection cannot drift** — after any sequence of real posts, `balance_minor == Σ(credits−debits)`
  holds *without* an app-side reconcile (the trigger maintains it); a direct attempt to desync is impossible
  via the posting path.
- **regression:** all existing 7/7 wallet + ledger-invariant tests stay green (reserve/commit/refund/credit,
  overdraw, B6, B8, concurrency) — the triggers must not break legitimate flows.
- The existing CI invariant job stays as a **belt** (should now always pass, since the DB enforces it).

## Design notes / trade-offs
- Deferred timing is essential: legs are inserted incrementally within one tx; the balance check only makes
  sense on the *complete* transaction at commit.
- Moving the projection into a trigger puts logic in the DB (a plpgsql function) — deliberate: for a money
  projection, correct-by-construction beats app-discipline-plus-monitoring. Keep the function small + owned
  by the migration owner (`app_migrator`), `search_path` pinned (same discipline as any DB function).
- Must be verified on a **non-super owner** (per the non-super-owner fix) — a superuser owner would bypass
  triggers/RLS and mask the enforcement, exactly the fidelity trap we just closed.
