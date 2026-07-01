# Glossary

Cross-cutting terms used across the architecture docs. Keep this as the single place to define
acronyms and concepts so the other docs don't each re-explain them.

---

## BFF — Backend-for-Frontend
A dedicated backend service that exists to serve **one specific frontend**, sitting between that
frontend (browser/app) and the core services/APIs.

```
Browser  ──►  BFF (the frontend's own backend)  ──►  core services / APIs
```

**In this platform:** `dashboard-api` is the BFF for the Next.js customer dashboard. The main
reason we use it (see `IDENTITY-SSO.md §4` and `§12.3`):

> **It holds the auth tokens server-side so they never touch browser JavaScript.**

WorkOS SSO flow with the BFF:
1. User logs in → WorkOS returns tokens to the **BFF**, not the browser.
2. The BFF seals them into an **httpOnly cookie** (`wos-session`) that JavaScript cannot read.
3. The browser sends only that opaque cookie; the BFF unseals + validates the session per request.

Payoff: **no JWTs in `localStorage`/JS** → closes the common XSS token-theft hole. A BFF also
**aggregates** (one screen's data from wallet + messages + billing in a single call), **shapes**
responses to exactly what that UI needs, and **protects** secrets/internal details from the client.

**BFF vs. the public API** — two deliberate front doors:

| | Audience | Auth | Shape |
|---|---|---|---|
| `public-api` (`/v1/...`) | Customers' developers (server-to-server) | `sk_live_*` API keys | Stable, versioned, general-purpose |
| `dashboard-api` (BFF) | Our own dashboard UI (browser) | httpOnly session cookie (WorkOS) | Tailored to dashboard screens |

Both reach the same underlying `SmsEngine`/`wallet`/`billing` — the BFF is the dashboard's private,
security-hardened entrance, **not** a second copy of the business logic.

---

## DLR — Delivery Report (a.k.a. Delivery Receipt)
The asynchronous status confirmation that comes **back** from the carrier/provider after a send,
telling you what actually happened to the message.

- At send time you only get **accepted/sent** (the provider took it) + a message ID.
- Seconds-to-minutes later the carrier posts a **DLR** to your webhook with the final outcome:
  `delivered · undelivered · failed · expired · rejected`.

Central to: the `sms/dlr` module (`MODULE-DECOMPOSITION.md §4.4`), billing reconciliation
(charge basis + refund-on-failure), the "no fake delivery reports" trust wedge, and failover
safety (don't blindly retry an ambiguous send — wait for the DLR).

---

## Tenancy / Tenant / Multi-tenant
**Tenancy** = how one shared application serves many isolated customers. A **tenant** is one
isolated customer (an `account` — a business that signs up). Everything that business owns
(wallet, messages, API keys, users) is scoped to its `tenant_id`.

- **Multi-tenant:** one app instance serves all tenants, separated by `tenant_id` (our choice).
- **Tenancy model (the hard-to-reverse decision, `ARCHITECTURE.md §2`):** shared DB, shared
  schema, `tenant_id` on every row, with Postgres **Row-Level Security (RLS)** as the backstop.
- One human can belong to multiple tenants → the SSO token carries an `org_id` (active tenant).

---

## Control plane vs. Data plane vs. Self-service plane
The three planes of the system (`CONTROL-PLANE-ADMIN.md`):
- **Control plane** — the internal **Admin** system; staff configure/monitor/govern all products.
  God-mode, low traffic, **never in the live request path**.
- **Data plane** — the products serving traffic (SMS engine, wallet runtime, APIs). High traffic.
- **Self-service plane** — customers configuring *their own* tenant (dashboards, dev portal),
  bounded by entitlements the control plane sets.

---

## Other recurring terms

- **CPaaS** — Communications Platform as a Service (SMS/voice/messaging via APIs + dashboards). Our category.
- **OIDC / SSO** — OpenID Connect, the identity layer over OAuth 2.0; **Single Sign-On** = one login across many apps.
- **RLS** — Row-Level Security; Postgres policies that reject any query not scoped to the right `tenant_id`.
- **Idempotency** — a repeated request (e.g. a retried send or top-up) produces the **same result once**, not duplicates; enforced via an `Idempotency-Key`.
- **Ledger (double-entry)** — append-only record of money movements; balance is a derived projection, never a mutable field. Invariant: `Σcredits − Σdebits = balance`.
- **Reserve → commit / refund** — the wallet lifecycle: hold funds on send, finalize on success, return them on failure.
- **LCR** — Least-Cost Routing; choosing the cheapest eligible provider for a destination.
- **Plugin *type* vs *instance*** — the adapter *code* (e.g. "Hubtel SMS") vs a configured, credentialed *activation* of it (`INTEGRATIONS-PLUGIN-ARCHITECTURE.md §1`).
- **Billable-status set + platform-fault exemptions** — per provider, the message statuses it charges us for + the failure causes we're never charged for (internal error, suspension, fraud-block, geo-block). We bill the customer on the same basis, minus our own faults (honest-billing model, `SMS-FEATURES-AND-POSITIONING.md §5.A`). *(Refined from the earlier binary `billingBasis: submission|delivered`.)*
- **JIT provisioning** — Just-In-Time: creating a local `users` row on first SSO login, keyed by the IdP `sub`.
- **Sender ID** — the alphanumeric/short name a message appears "from"; must be registered/approved per country.
- **Segment** — one SMS unit (160 GSM-7 chars, or 70 UCS-2 for unicode/emoji); longer messages = multiple segments = higher cost.

---

## Data protection (see `COMPLIANCE-AND-DATA-PROTECTION.md`)

- **Controller vs Processor** — the **controller** decides why/how personal data is processed; the **processor** acts on the controller's instructions. We are **processor** for our tenants' recipients' data, **controller** for our tenants' own user/billing data.
- **DPA — Data Processing Agreement** — the contract a processor gives a controller setting out how it handles personal data; we auto-incorporate ours into the ToS.
- **Sub-processor** — a third party the processor uses to process data (our SMS/payment vendors). Must be disclosed to tenants; our plugin instances each = a declared sub-processor.
- **DSR — Data-Subject Request** — a person exercising rights over their data: access, rectification, **erasure**, portability, restriction, objection.
- **PII vault** — the only table holding raw personal data (phone, body, attributes), encrypted; everything else references a `subject_id` surrogate.
- **`subject_id`** — stable surrogate key for a data subject; used everywhere instead of the raw phone number so PII can be detached/erased without breaking financial/audit records.
- **Crypto-shredding** — "erasure" by destroying the per-subject encryption key (DEK), rendering that subject's PII permanently unreadable while immutable ledger/audit rows stay intact.
- **Data residency** — the requirement/choice that personal data be stored/processed in a specific country/region (e.g. CBN local-storage rules flowing from our fintech customers).
- **NDPA / Ghana DPA / GDPR** — Nigeria Data Protection Act 2023 / Ghana Data Protection Act 2012 / EU General Data Protection Regulation; we target a **GDPR-grade baseline** that satisfies the African laws (which mirror it).
