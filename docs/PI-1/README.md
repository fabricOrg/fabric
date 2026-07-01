# PI 1 — User Stories

One file per backlog **feature** (see `../PI-1-BACKLOG.md` for evidence, value, and sequencing).
Each file: **Why → Stories → Acceptance Criteria → Design notes → Out of scope → Definition of Done.**
Only PI-1 committed items (MUST/STRETCH) have story files here; PI-2 fast-follows are listed at the
bottom and are intentionally not detailed yet.

**Roles:** `Developer` (API), `Tenant admin` / `Business user` (dashboard), `End recipient`,
`Operator` (staff/control-plane), `Compliance officer`, `Platform` (system/enabler).

**Definition of Ready / Done conventions:** every money/PII story ships with automated tests;
the ledger-invariant check (F1.5) must stay green; the PI System Demo = `WALKING-SKELETON.md` 9-step
script + OTP + a STOP-blocked send.

**Known cross-iteration coupling:** F3.2 (two-phase debit, Iter 2) ships the reserve/commit/refund
*mechanism*; the commit-vs-refund *decision* (F3.5) depends on canonical statuses (F5.3, Iter 3) — so
F3.2 lands first with the decision wired when F5.3/F3.5 arrive. Sequence accordingly.

## ⚠️ Scope realism — the THIN THREAD (ship this end-to-end first)
This PI lists more MUST work than one team-PI can finish. Protect a complete vertical thread; if
capacity runs out, the rest slips to **PI-1.5**, not the thread. **Thin thread (must ship E2E):**
> F1.1 · F1.2 · F1.3 · F1.4 · F1.5 · **F7.1** · F2.1 · F2.3 · **F3.1 · F3.2 · F3.3 · F3.4 · F3.5** ·
> **F5.1 · F5.2 · F5.3 · F5.4** · **F7.2 · F5.7** (opt-out + inbound) · **F7.3** (sender-ID) ·
> **F4.1 · F4.2 · F4.3** (top-up + reversals) · F8.2 · F8.3 · F8.5 · **F6.1** (Verify) ·
> F9.1 · F9.4 (config + maker-checker).

**Slip-first if needed (PI-1.5):** F5.5, F5.6, F6.2/F6.3, F7.4 fine-tuning, F7.5 (DLR-trust),
F7.6 tooling, F7.7, F8.1, F8.4, F8.6, F8.7, F1.6, F3.6 (beyond one currency), F3.7, F9.2/F9.3/F9.5.
*(The thin thread = the 9-step PI System Demo. Everything else hardens or broadens it.)*

## Also tracked (planning-level, not story files)
Tenant offboarding/closure + residual-balance handling (PI-2) · a QA/test-harness enabler ·
secrets-manager + backups/PITR + observability-stack setup (enablers) · impersonation (per §16).

---

## Index

### E1 — Foundations & tenancy *(Iter 1)*
- [F1.1 Multi-tenancy + RLS](E1-foundations/F1.1-multi-tenancy-rls.md) · MUST
- [F1.2 Events-bus (transactional outbox)](E1-foundations/F1.2-events-bus-outbox.md) · MUST
- [F1.3 Idempotency service](E1-foundations/F1.3-idempotency-service.md) · MUST
- [F1.4 Immutable audit log](E1-foundations/F1.4-audit-log.md) · MUST
- [F1.5 Observability + ledger-invariant job](E1-foundations/F1.5-observability.md) · MUST
- [F1.6 Platform notifications (transactional)](E1-foundations/F1.6-platform-notifications.md) · MUST

### E2 — Identity, SSO & API keys *(Iter 1–2)*
- [F2.1 Customer SSO (WorkOS)](E2-identity-access/F2.1-customer-sso.md) · MUST
- [F2.2 Staff identity + admin RBAC](E2-identity-access/F2.2-staff-identity-rbac.md) · MUST
- [F2.3 API keys (live/test + scopes)](E2-identity-access/F2.3-api-keys.md) · MUST

### E3 — Wallet, ledger & billing *(Iter 2)*
- [F3.1 Wallet + double-entry ledger](E3-wallet-ledger-billing/F3.1-wallet-double-entry-ledger.md) · MUST
- [F3.2 Two-phase debit (reserve→commit/refund)](E3-wallet-ledger-billing/F3.2-two-phase-debit.md) · MUST
- [F3.3 Reservation-TTL sweeper](E3-wallet-ledger-billing/F3.3-reservation-sweeper.md) · MUST
- [F3.4 Rating + usage records](E3-wallet-ledger-billing/F3.4-rating-usage-records.md) · MUST
- [F3.5 Billable-status set + platform-fault exemptions](E3-wallet-ledger-billing/F3.5-billable-status-exemptions.md) · MUST
- [F3.6 Enabled-currency config](E3-wallet-ledger-billing/F3.6-currency-config.md) · MUST
- [F3.7 Low-balance alert](E3-wallet-ledger-billing/F3.7-low-balance-alert.md) · MUST

### E4 — Payments / top-up *(Iter 4)*
- [F4.1 Payment provider integration](E4-payments-topup/F4.1-payment-provider-integration.md) · MUST
- [F4.2 Top-up flow (verify-on-server)](E4-payments-topup/F4.2-topup-flow.md) · MUST
- [F4.3 Payment reconciliation & reversals](E4-payments-topup/F4.3-payment-reconciliation-reversals.md) · MUST

### E5 — SMS engine & delivery *(Iter 3)*
- [F5.1 SMS plugin contract + adapter + FakeProvider](E5-sms-engine-delivery/F5.1-sms-plugin-contract.md) · MUST
- [F5.2 Send pipeline + segmentation](E5-sms-engine-delivery/F5.2-send-pipeline-segmentation.md) · MUST
- [F5.3 Normalized message-status model](E5-sms-engine-delivery/F5.3-message-status-model.md) · MUST
- [F5.4 DLR ingestion + reconciliation](E5-sms-engine-delivery/F5.4-dlr-ingestion-reconciliation.md) · MUST
- [F5.5 Smart-encoding warning / segment quote](E5-sms-engine-delivery/F5.5-smart-encoding-quote.md) · MUST
- [F5.6 Basic bulk/batch send](E5-sms-engine-delivery/F5.6-bulk-send.md) · STRETCH
- [F5.7 Inbound message ingestion (MO)](E5-sms-engine-delivery/F5.7-inbound-message-ingestion.md) · MUST

### E6 — OTP / Verify *(Iter 4)*
- [F6.1 Managed Verify](E6-otp-verify/F6.1-managed-verify.md) · MUST
- [F6.2 OTP body redaction](E6-otp-verify/F6.2-otp-body-redaction.md) · MUST
- [F6.3 SMS-pumping / fraud protection](E6-otp-verify/F6.3-pumping-fraud-protection.md) · MUST

### E7 — Compliance & data protection *(Iter 1, 3)*
- [F7.1 PII tokenization (vault + crypto-shred)](E7-compliance/F7.1-pii-tokenization.md) · MUST
- [F7.2 Opt-out / STOP engine](E7-compliance/F7.2-opt-out-engine.md) · MUST
- [F7.3 Sender-ID registration workflow](E7-compliance/F7.3-sender-id-registration.md) · MUST
- [F7.4 Message-body handling](E7-compliance/F7.4-message-body-handling.md) · MUST
- [F7.5 DLR-trust probing](E7-compliance/F7.5-dlr-trust-probing.md) · MUST
- [F7.6 Governance (DPA, consent, residency)](E7-compliance/F7.6-governance-dpa-residency.md) · MUST
- [F7.7 DSR (operator-initiated)](E7-compliance/F7.7-dsr-operator.md) · MUST

### E8 — Developer experience & public API *(Iter 5)*
- [F8.1 API versioning](E8-developer-experience/F8.1-api-versioning.md) · MUST
- [F8.2 Idempotency-Key (public API)](E8-developer-experience/F8.2-idempotency-key-api.md) · MUST
- [F8.3 Error model + request IDs](E8-developer-experience/F8.3-error-model-request-ids.md) · MUST
- [F8.4 Outbound webhooks](E8-developer-experience/F8.4-outbound-webhooks.md) · MUST
- [F8.5 Test mode + magic numbers](E8-developer-experience/F8.5-test-mode-magic-numbers.md) · MUST
- [F8.6 TypeScript SDK + dev portal](E8-developer-experience/F8.6-ts-sdk-docs.md) · MUST-basic
- [F8.7 Rate limiting & quotas](E8-developer-experience/F8.7-rate-limiting-quotas.md) · MUST

### E9 — Control plane / admin console *(Iter 5)*
- [F9.1 Config (currencies, pricing, providers)](E9-control-plane/F9.1-config.md) · MUST
- [F9.2 Tenant inspection](E9-control-plane/F9.2-tenant-inspection.md) · MUST
- [F9.3 Sender-ID approval queue](E9-control-plane/F9.3-sender-id-approval.md) · MUST
- [F9.4 Wallet adjustment (maker-checker)](E9-control-plane/F9.4-wallet-adjustment.md) · MUST
- [F9.5 Health & DLR-trust dashboard](E9-control-plane/F9.5-health-monitoring.md) · MUST

---

## Deferred to PI 2 (no story files yet)
Key rotation w/ overlap (F2.4) · auto-recharge + spend caps (F3.7b) · channel-fallback OTP (F6.4) ·
DSR-by-API (F7.7b) · webhook replay UI + CLI + multi-lang SDKs (F8.4b/F8.6b) · DSR/sub-processor/
breach console (F9.6) · business dashboard · generic failover engine · payment plugin framework ·
Lookup/line-type · Messaging-Service sender pools · omnichannel.
