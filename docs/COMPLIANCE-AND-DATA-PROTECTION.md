# Compliance & Data Protection

**Status:** Design v1 · **Date:** 2026-06-02 · **Companion to:** all architecture docs
**Grounded in:** competitor research (Twilio, Infobip, Bird, Vonage) + legal review of Ghana DPA
2012, Nigeria NDPA 2023, GDPR (sources at end).

> ⚠️ **Not legal advice.** This is an engineering/design posture. Engage qualified counsel in each
> launch market (Ghana, Nigeria) and a DPO before processing real personal data.

---

## 0. Why this exists / the core realization
Our data **is** personal data — phone numbers and message content. Across the docs we had good
*primitives* (encryption, retention, opt-out, audit, RLS) but **no posture**: no controller/
processor model, no erasure mechanism, no DPA, no residency decision. The research shows the
incumbents treat compliance as a **productized capability** (published DPA, sub-processor list,
selectable residency, ISO/SOC certs, DSR-by-API). The African competitors mostly **don't** —
which makes a real posture a genuine **differentiator** here, not just a cost.

---

## 1. Which laws govern us (and the GDPR-as-baseline strategy)

| Regime | When it applies | Notes |
|---|---|---|
| **Ghana DPA 2012 (Act 843)** | Launching/processing in Ghana | **Mandatory DPC registration before processing** (renew every 2 yrs); unregistered processing is a **criminal offence**; requires a **Data Protection Supervisor**, privacy notices, consent, breach notification |
| **Nigeria NDPA 2023** | Processing/targeting Nigerian data subjects (extraterritorial) | GDPR-aligned; NDPC enforces; "data controllers of major importance" register; cross-border needs adequacy/safeguards |
| **GDPR** | EU residents' data, or EU/enterprise customers | Our **baseline** — the African laws mirror it, so a GDPR-grade posture satisfies most at once |
| **Sector rules** | — | **CBN: financial institutions must store data locally** + approve cross-border (flows to us via fintech customers); NITDA: government data in-Nigeria; NCC: telecom subscriber DB in-country; **telecom marketing consent / DND** |

**Strategy: build a GDPR-grade common-denominator posture; satisfy each market's specifics on top.**
The expensive surprise from research → **data residency is launch-gating** because our fintech
customers carry **CBN local-storage obligations** that flow to us.

---

## 2. Controller vs Processor — the foundational model

| Data | Our role | Our duties |
|---|---|---|
| Tenants' **recipients'** data (phone numbers, message bodies, contacts) | **Processor** (tenant = controller) | Process only on documented instruction; offer a **DPA**; disclose **sub-processors**; assist with DSRs; security; breach support |
| Tenants' **own users** (staff accounts, profile), **billing data** | **Controller** | Lawful basis, privacy notice, retention, honor DSRs directly |
| Telemetry/logs containing PII | Mixed | Minimize + retention |

This dual role drives everything below. **A DPA must be offered to every tenant** (auto-incorporated
into ToS, à la Twilio/Infobip — no negotiation for standard customers).

---

## 3. Target posture vs the competitive bar (from research)

| Capability | Incumbent bar | Our target |
|---|---|---|
| **DPA** | Auto-incorporated; BCRs (Twilio) | **P1:** DPA template auto-incorporated into ToS |
| **Sub-processor list** | Published + change notifications | **P1:** published list (each plugin instance = a sub-processor); notifications fast-follow |
| **Data residency** | EU/US/APAC selectable | **P1 decision** (see §8): in-region default + per-tenant capability |
| **Certifications** | ISO 27001/27017/27018, SOC 2 II | **Design to be *certifiable* P1**; certify on enterprise demand |
| **DSR / erasure** | Bird **Personal Data API** (by phone/email/IP → webhook) | **Adopt the pattern** — DSR-by-API (differentiator); manual P1, API fast-follow |
| **Erasure vs retention** | Bird: can't erase legally-retained; keep request-proof 5 yrs | **Adopt** — crypto-shred PII, retain financial/audit (§5) |

---

## 4. Personal-data inventory (data map)

| Data | Category | Where | Sensitivity |
|---|---|---|---|
| Recipient phone number | Personal data | `messages`, `contacts`, `sender_ids`(no), DLRs, OTP | High (identifier) |
| Message body | Personal data (can be sensitive) | `messages.body` (encrypted, redactable) | High |
| Contact attributes | Personal data | `contacts.attributes` | Medium |
| Tenant-user identity | Personal data | `users` (via WorkOS `sub`) | Medium |
| Billing/ledger | Financial records | `wallets`, `ledger_*`, `topups` | Retain (legal basis) |
| Audit log | Operational + PII refs | `audit_log` | Retain (immutable) |
| Logs/traces | May contain PII | observability stack | Minimize |

---

## 5. ★ Erasure vs the append-only ledger/audit — the schema-shaping decision

The "right to erasure" collides with two deliberately-immutable stores (ledger, audit).
**Resolution (validated by Bird's published approach): you do NOT delete financial/audit records;
you render the PII in them unreadable while keeping the records.** This is lawful — DP laws permit
retaining data needed for accounting/legal obligations.

**Recommended mechanism — crypto-shredding + a PII vault:**
- Store raw PII (phone, body, contact attributes) **only** in a `pii_vault`, encrypted with a
  **per-subject Data Encryption Key (DEK)**.
- Everywhere else (ledger, messages metadata, audit) reference a **stable surrogate `subject_id`**,
  never the raw phone number. Display/use resolves through the vault.
- **Erasure = destroy that subject's DEK** → all their PII becomes permanently unreadable in one
  operation, while ledger/audit rows stay intact (amounts, timestamps, `subject_id` surrogate
  remain for financial/legal integrity).
- Keep an **erasure record** (proof of the request + that it was honored) — retained per legal
  requirement (Bird keeps such proof ~5 years).

```sql
-- Raw PII isolated + per-subject encrypted; everything else references the surrogate.
data_subjects(subject_id uuid pk, tenant_id, created_at)          -- the stable surrogate
pii_vault(subject_id→data_subjects, kind[phone|body|attr], ciphertext bytea, dek_id)
dek_keys(dek_id pk, subject_id, status[active|destroyed], destroyed_at)  -- destroy = erasure
erasure_log(id, tenant_id, subject_id, requested_by, requested_at, completed_at, basis)

-- messages/ledger reference subject_id, NOT the raw number:
-- messages(... to_subject_id→data_subjects, body_ref→pii_vault ...)
-- ledger_entries(... reference_subject_id ...)   -- amount/time retained; PII detached
```

> **This is why compliance had to be settled before migrations:** `subject_id` surrogates +
> `pii_vault` change the shape of `messages`, `contacts`, and the ledger refs. Retrofitting PII
> tokenization after the schema exists is a painful, risky migration.

---

## 6. Data-subject rights (DSR) — API-first, à la Bird

Support access · rectification · **erasure** · portability · restriction · objection.

- **As processor:** a tenant submits a DSR for one of *their* recipients → we execute against that
  tenant's data only (tenant-scoped, RLS-enforced).
- **As controller:** tenant-users exercise rights over their own account data directly.
- **Mechanism:** **DSR endpoints** that accept an identifier (phone/email) and perform
  access-export or erasure (DEK destroy), returning async to a webhook — **emulating Bird's
  Personal Data API**. Manual operator flow in P1; self-serve API fast-follow.
- Every DSR action is **audited** and produces an `erasure_log`/access record.

---

## 7. Sub-processors — cleaner for us than for incumbents

- Every external vendor (Hubtel, Twilio, Paystack…) that processes recipient data **for** us is a
  **sub-processor**. We owe tenants a **disclosed list + flow-down terms**.
- Our **plugin model makes this self-documenting**: each enabled `integration_instance` is a
  declared sub-processor; the control plane can **render the sub-processor list from config**.
- **Vertical-integration payoff:** rolling out our own gateway/rails (`INTEGRATIONS §10b`)
  **removes sub-processors** — a real compliance + trust selling point.

---

## 8. Data residency — launch-gating decision (forced by CBN)

Research finding: **our fintech customers' CBN obligations flow to us** (local storage + cross-
border approval), plus NDPA sovereignty direction. So residency is **not** a "later" item.

- **Default hosting region must support African data residency** (in-region hosting, or a cloud
  region acceptable under NDPA/CBN; confirm with counsel).
- **Per-tenant / per-region residency capability** — reuse the **dedicated single-tenant
  deployment** escape hatch (`ARCHITECTURE.md §2`) for enterprise/regulated tenants needing
  physical isolation/localization.
- **Cross-border transfers** (e.g. an SMS plugin whose vendor is offshore) need adequacy/safeguards
  — model a `data_region` on tenants and on `integration_instances` so routing can respect it.

**→ OPEN DECISION (§12.1): pick the launch hosting region/provider with CBN/NDPA in mind.**

---

## 9. Consent, opt-out, DND (telecom + DP overlap)
- **Opt-out/STOP suppression** — already elevated to **P1** (`WALKING-SKELETON`): block sends to
  opted-out numbers; inbound STOP auto-suppresses. Engine-enforced, not a dashboard nicety.
- **Consent capture** — tenants are responsible for recipient consent (they're the controller);
  we provide tooling + record consent state. Marketing/promotional routes require it.
- **DND routing** + per-country sender-ID/marketing rules → the per-country rule engine (later).

---

## 10. Retention schedule (storage limitation)

| Data | Default retention | Then |
|---|---|---|
| Message bodies | ~180 days (configurable per tenant) | purge (null) — metadata kept |
| Message metadata (status, cost, segments) | Billing/legal period | retain (financial) |
| Contacts | While tenant active / per instruction | erase on request/termination |
| Ledger / billing | Statutory accounting period (market-specific) | retain (legal basis) |
| Audit log | Long (immutable) | retain |
| DSR/erasure proof | ~5 years | retain (compliance evidence) |
| Logs/traces with PII | Short (e.g. 30–90d) | purge |

Configurable defaults authored in the **control plane** (`account_settings`, global settings).

---

## 11. Security → certifiability (ISO 27001 / SOC 2 roadmap)
We already have the bones of a certifiable ISMS — make them deliberate:
- Encryption at rest (incl. `pii_vault`) + TLS in transit · RLS tenant isolation · least-privilege
  staff RBAC + MFA-all + step-up · immutable audit · secrets manager · idempotency · backups/PITR.
- **Design to be certifiable in P1; pursue ISO 27001 + SOC 2 Type II when enterprise/fintech sales
  demand it.** (Incumbents lead with these; it's table stakes for big accounts.)

---

## 12. Governance artifacts
- **DPA template** (processor terms, sub-processor list, SCCs/transfer terms) — **P1**.
- **Privacy notices + consent forms** (Ghana DPA requires) — **P1**.
- **RoPA** (Records of Processing Activities) — fast-follow.
- **Breach response runbook** — detect → contain → assess → **notify DPA + affected** within the
  statutory window (GDPR 72h; align local) → remediate. Control plane is the natural tooling home.
- **DPIA** for high-risk processing — when relevant.
- **Appointed roles:** a **Data Protection Supervisor** (Ghana) / **DPO** (GDPR/NDPA).

---

## 13. Phasing

**P1 — launch-blocking**
- **Ghana DPC registration** + appoint Data Protection Supervisor (administrative, do early).
- **Data residency / hosting region decision** (§8) — gates infra setup.
- **PII tokenization schema** (`subject_id` + `pii_vault` + crypto-shred) — must precede migrations.
- **DPA template** auto-incorporated; privacy notices/consent.
- **Opt-out/STOP suppression** (already in P1).
- Encryption, retention purge job, audit (already in P1).

**Fast-follow**
- DSR-by-API (access/erasure → webhook); self-serve sub-processor list + change notifications;
  RoPA; consent-capture tooling; breach runbook tooling.

**Later**
- ISO 27001 / SOC 2 certification; per-country compliance rule engine; DPIA; per-tenant residency
  deployments.

---

## 14. Open decisions
1. **Launch hosting region/provider** that satisfies NDPA/CBN residency expectations (counsel-confirmed).
2. **DPO / Data Protection Supervisor** — who, internal vs fractional, for Ghana + Nigeria.
3. **Crypto-shredding vs vault-anonymization** as the primary erasure mechanism (recommend
   crypto-shredding; confirm key-management approach with the chosen cloud/KMS).
4. **DSR self-serve API in P1 or fast-follow?** (Recommend fast-follow; manual operator flow at launch.)

---

## Sources
- Twilio DPA: https://www.twilio.com/en-us/legal/data-protection-addendum · Sub-processors: https://www.twilio.com/en-us/legal/sub-processors · EU SMS data residency: https://www.twilio.com/docs/global-infrastructure/sms-eu-data-residency
- Infobip privacy practices: https://www.infobip.com/overview-of-our-key-privacy-practices · Certificates: https://www.infobip.com/certificates
- Bird DPA: https://bird.com/en-us/legal/dpa · Personal Data API: https://developers.messagebird.com/api/personal-data · Security/erasure: https://docs.bird.com/connectivity-platform/data-governance-and-security/messagebird-security-overview
- Vonage DPA: https://www.vonage.com/legal/data/dpa/
- Ghana DPC registration: https://dataprotection.org.gh/registration/ · Ghana DPA overview: https://www.lexology.com/library/detail.aspx?g=98999f8e-d0c4-480d-b345-d9090b953c31
- Nigeria NDPA (ICLG 2025-26): https://iclg.com/practice-areas/data-protection-laws-and-regulations/nigeria · Data localization: https://www.recordinglaw.com/world-laws/world-data-privacy-laws/data-localization-laws-by-country/
