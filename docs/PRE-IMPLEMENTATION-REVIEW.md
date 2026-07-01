# Pre-Implementation Review (architecture + flows)

**Status:** Gate · **Date:** 2026-06-04 · Run before writing any PI-1 code.
**Method:** independent adversarial flow review (backend-systems architect) + AWS af-south-1 availability check + AWS account-structure research.

## ✅ RESOLVED 2026-06-04 — all 9 blockers + S1/S3/S4/S5/S6/S7/S8 + N1/N5 folded into the PI-1 stories
The resolutions below are now written as acceptance criteria in the affected story files (F1.1, F1.3,
F3.2, F3.3, F4.2, F5.1, F5.2, F5.3, F5.4, F6.1, F7.1, F8.2, F8.4, F8.7). The application code is now
**code-ready on the flow dimension.** Remaining gates are AWS landing-zone setup (§D) + the standing
product decisions (launch market/vendor, DPO). Original analysis retained below for traceability.

---

## Verdict (original) — ⛔ NOT code-ready yet (9 blockers), all resolvable with decisions + doc edits
The design's *direction* is sound (idempotency, double-entry, crypto-shred, RLS backstop are the right calls). But the **flows have concrete correctness holes and underspecifications** that must be locked before the first migration — most importantly the **RLS-vs-connection-pooling** issue, which is a silent cross-tenant data-leak risk. None require re-architecting; they require deciding precise behavior and writing it into the stories.

---

## A. BLOCKERS — resolve before writing code

| # | Flow | Problem | Resolution |
|---|---|---|---|
| **B1** | SMS / billing | Canonical status enum (`F5.3`) has **no `accepted` state**, yet billing "commits on accepted/billable status." `sent` is ambiguous (handed-to-provider vs submitted-to-MNO). `billableStatuses[]` can't express acceptance. | Add **`accepted`** (submitted) between `sending` and `sent`; define exactly which transition is the **commit point**; write the first provider's raw→canonical mapping now. |
| **B2** | SMS money | Provider **accepts but we crash before persisting the provider ref** → BullMQ retry double-sends + double-commits. The reserve is idempotent; the provider call isn't. | Persist a `provider_attempt` row with a **deterministic per-message provider idempotency key** in the same txn that sets `sending`, *before* the network call; pass it on every retry; commit guarded by compare-and-set on status+version. Verify the chosen provider honors an idempotency key — if not, treat ambiguous outcomes as `unknown` (no blind retry). |
| **B3** ★ | Tenancy | **`SET LOCAL app.tenant_id` + RDS Proxy/PgBouncer transaction pooling = cross-tenant leak** if context isn't strictly transaction-scoped. Highest blast radius. | Mandate: every tenant-scoped op runs inside a `db.transaction()` whose first statement is `SET LOCAL app.tenant_id`. Never `SET` without `LOCAL`. Add an interleaved-two-tenant pool test asserting no leakage. Decide pooling mode now. |
| **B4** | Tenancy | **Table owner / superuser bypasses RLS by default** — if app + migrations share the owner role, RLS is effectively off. | Two roles: owner (migrations) + non-owner runtime role without `BYPASSRLS`; `ALTER TABLE … FORCE ROW LEVEL SECURITY` on every tenant table. Admin cross-tenant reads go through a separate, audited, explicit-policy path. |
| **B5** | Idempotency | "Request fingerprint" for same-key/different-body conflict is **undefined**, and must be computed on raw inbound bytes (before PII tokenization / server enrichment) or legit retries falsely conflict. | Fingerprint = SHA-256 of canonicalized **raw body + method + path**, computed at the edge before tokenization; specify excluded headers/fields; add a byte-identical-retry test that must NOT conflict. |
| **B6** ★ | DLR / sweeper | **DLR vs reservation-sweeper double-resolution** race: both read "unresolved," both post → double-refund or refund+commit; ledger invariant breaks. Guard asserted everywhere, defined nowhere. | Single **resolution state machine on the message/reservation row** (`reserved → committed \| refunded`, terminal), `SELECT … FOR UPDATE` + compare-and-set in both the DLR handler and the sweeper; partial unique index for one resolution per message. Named PI-1 AC + concurrent test. |
| **B7** | PII / erasure | **Crypto-shred during an in-flight send** (DEK destroyed before worker reads recipient) → worker can't decrypt → undefined outcome (stuck reservation?). DEK cache eviction is per-node TTL → residual readability after erasure. | Either **block/defer erasure while the subject has non-terminal messages**, or terminate such sends as `failed` (platform/compliance code) + **refund**. Pick one + test. DEK-cache invalidation must be **cluster-wide (Redis pub/sub)**, not per-node TTL; document the bounded residual window. |
| **B8** | Top-up | Verify on **both** callback and webhook, each posting a credit → TOCTOU **double-credit** if app-level "already credited?" check isn't a DB constraint. | `UNIQUE` constraint on `ledger_transactions.idempotency_key` (derived from `topup_id`); dedupe by insert-conflict, not read-then-write. **Only the webhook credits**; the callback only reads/polls. Concurrent callback+webhook test. |
| **B9** | OTP | Verify **attempt-limit has no concurrency control** → N parallel guesses all read `attempts=4` → brute-force bypass. Security defect. | Atomic counter: `SELECT … FOR UPDATE` on the otp_request row (increment+check in one txn) or atomic Redis `INCR`; constant-time compare; concurrent-guess test asserting the cap holds. |

★ = highest priority (B3 = silent cross-tenant leak; B6 = money correctness).

---

## B. SHOULD — resolve early

- **S1 · Suppression-check ordering contradiction:** `F5.2` AC says reserve→suppression; everywhere else says **before reserve**. Fix `F5.2` to `normalize → encode → suppression check → rate → reserve → send`.
- **S2 · STOP vs in-flight send:** unavoidable single-message race; do the suppression check as late as safe, document the bounded residual as compliant-acceptable.
- **S3 · Segment reconciliation has no data source:** `ARCHITECTURE §5` promises "adjust cost if actual≠estimate segments," but most DLRs don't carry actual segments. Confirm for the first provider; if absent, the reserved estimate *is* the charge — say so and drop the phantom path.
- **S4 · Sweeper TTL:** no default; set ~60 min (> provider DLR latency); decide whether a late authoritative `delivered` DLR may flip a sweeper-refund to commit, or accept the revenue loss.
- **S5 · Negative-balance gating:** gate sends on `balance_minor >= cost` where the projection updates **in the same txn** as every ledger posting (not async outbox); a negative balance then naturally blocks sends — no separate flag.
- **S6 · Outbox at-least-once → webhook double-effects:** include event `id` + per-message sequence so tenants dedupe/order; billing finalizer must not be driven *only* by an at-least-once event without the B6 terminal guard.
- **S7 · Rate-limit atomicity:** implement the token bucket as one atomic Redis Lua script (or `CL.THROTTLE`), or bursts bypass the fraud/pumping controls.
- **S8 · DLR dedupe key undefined:** `UNIQUE(provider_instance, provider_message_ref, status)` (or provider DLR id); reconciliation driven off first successful insert under the B6 lock.

## C. Cross-doc contradictions to fix
1. Suppression order — `F5.2` AC vs `F7.2`/WALKING-SKELETON (S1).
2. Segment reconciliation promised in `ARCHITECTURE §5`, implemented nowhere (S3).
3. Status enum has no `accepted`, billing commits on it (B1).

---

## D. AWS readiness (now that the account exists)

### D1. af-south-1 service availability — confirmed vs verify
- **Confirmed available:** ECS/Fargate, ElastiCache (node-based Redis), RDS PostgreSQL, **CodeDeploy + ECS blue/green**, KMS, S3, ECR, CloudFront (global), Route 53 (global). Aurora SV2 + **RDS Proxy** confirmed GA in earlier field research.
- **Verify in-console now (you have the account):** **RDS Proxy**, **AWS WAF**, **Secrets Manager**, **AWS Client VPN**. WAF/Secrets Manager are near-certain; **Client VPN may be absent** → fallback for admin access = **IAM Identity Center + IP-allowlist on the internal ALB**, or **AWS Verified Access**, instead of Client VPN.
- **Action:** open the AWS *Services by Region* table filtered to af-south-1 and tick off every dependency before writing Terraform.

### D2. Account / org structure — set up the landing zone first
You have one account; don't build everything in it. Recommended (matches our 3-plane + certifiability posture):
- **AWS Organizations + Control Tower landing zone** → OUs: `Security`, `Infrastructure`, `Workloads/Sandbox`, `Workloads/Staging`, `Workloads/Prod`. Separate **AWS accounts per environment** (staging, prod) under Workloads; a dedicated **log-archive** + **audit** account (Control Tower creates these).
- **IAM Identity Center (SSO)** for human access with permission sets per role (mirrors our staff RBAC); **no IAM users**.
- **CI → AWS via GitHub OIDC** (federated role per env) — no long-lived keys.
- **Org-wide guardrails:** CloudTrail org trail, Config, SCPs (e.g. deny leaving af-south-1/allowed regions, deny disabling logging), centralized billing + budget alerts (watch the af-south-1 premium).

### D3. Terraform bootstrap (chicken-and-egg)
- Bootstrap the **state backend first**: an S3 bucket (versioned, encrypted, SSE-KMS) + DynamoDB lock table, created via a minimal bootstrap config (or ClickOps once, then import). Lock down bucket access.
- Then per-env stacks: VPC (large **/20+** subnets across 3 AZs — Fargate has no ENI trunking, B-side of the deployment review), RDS, **two ElastiCache Redis** (queue: noeviction+AOF; cache: LRU), KMS keys, Secrets Manager, ECR, one Fargate service skeleton + ALB + WAF.
- Module the per-tenant/per-region stack so the residency escape hatch is `for_each`, not a fork.

### D4. Iteration-0 order (revised)
`Org/Control Tower landing zone → Identity Center + OIDC → TF state backend → VPC + data tier (RDS, 2× Redis, KMS, Secrets) → ECR + one Fargate service + ALB/WAF + pipeline → Grafana Cloud + Sentry (PII-scrub at source) → status page`. Only then start app code on the thin thread.

---

## E. Lock-before-code checklist
**Decisions (no code):** B1 status+commit-point · B3 pooling mode + RLS pattern · B4 two-role model · B6 resolution state machine · B7 erasure-vs-in-flight policy + cluster DEK invalidation · B5 fingerprint spec · B8 webhook-only credit + unique constraint · B9 atomic OTP counter · S1 suppression order · S3 segment-reconciliation stance · af-south-1 service verification · AWS OU/account structure.

**Then:** fold each resolution into the affected PI-1 story / design doc (so the AC encodes it) → set up the landing zone + TF backend → migrations (with the two-role + FORCE RLS + SET-LOCAL pattern baked in) → thin-thread code.

> **Go/no-go:** GO to *infrastructure bootstrap* (D2–D4) now — it's independent of the flow blockers. NO-GO on *application code* until B1–B9 + S1/S3 are resolved and written into the stories.
