# PI-2 UI design prompts — for Claude (design / prototype)

Three prompts, one per frontend surface. Each is **self-contained** but assumes the **Shared
Context** block below — paste that first, then the surface prompt. Grounded in what PI-1 actually
built (the API, money ledger, message model) so the mockups are authentic, not generic SaaS.

Source of truth: `team/frontend/PROPOSAL-fe-auth-bff-seam.md` (topology + realms), `docs/ARCHITECTURE.md`,
`docs/IDENTITY-SSO.md`, `docs/PI-1/**` (feature specs). Design-system tokens live in `packages/ui`
(edison) — white-label means **one brand anchor color per tenant**, everything else neutral tokens.

---

## SHARED CONTEXT (prepend to every prompt)

> **Product.** You are designing UI for **jojo** — a multi-tenant **CPaaS + Payments + Identity**
> platform for the African market (launch focus: Ghana + Nigeria, currencies **GHS / NGN / USD**).
> Think "Twilio + Stripe for Africa," developer-first. Businesses top up a prepaid **wallet**, then
> send **SMS** (and soon OTP/Verify) through one API. Every send moves real money through a
> double-entry ledger, so the UI must feel **trustworthy and exact about money** — never fuzzy.
>
> **Aesthetic direction.** Modern, calm, developer-grade. Reference points: Stripe (clarity +
> restraint), Linear (density without clutter), Paystack/Flutterwave (African fintech warmth).
> **Avoid** the templated dashboard look (no generic gradient hero, no random pastel cards, no
> stock illustrations). Confident typography, generous whitespace around money figures, real data
> density in tables. It should read as a serious money+infrastructure product.
>
> **Design system (hard constraints).**
> - **White-label:** the platform is resold per-tenant. Use a **single brand anchor color** (a CSS
>   variable, e.g. `--brand`) for primary actions/active states; everything else is neutral
>   grayscale + semantic tokens. Design must look correct when `--brand` is swapped (show it once in
>   a strong blue-teal default, once in a contrasting brand, to prove it holds).
> - **Light + dark** themes, both first-class.
> - **Responsive**, desktop-first for consoles but fully usable at tablet/mobile widths.
> - **Accessibility: WCAG 2.1 AA** — visible focus rings, 4.5:1 contrast, keyboard-navigable tables
>   and dialogs, no color-only status encoding (pair color with icon/label).
> - **Money is exact:** always show currency + minor-unit precision (e.g. `GHS 1,204.03`), never a
>   bare number. Monospace or tabular figures for amounts.
> - **Every error state** shows a user-safe message **plus a `request_id`** ("contact support with
>   `req_…`") — this is a platform convention (the F8.3 error envelope). Design a reusable error
>   toast/inline pattern for it.
>
> **Global states to design for every screen:** loading (skeleton), empty (first-run, with a clear
> next action), error (with `request_id`), and populated. Don't only show the happy full state.

---

## PROMPT 1 — `dashboard` (customer realm · the SMS product)

> **Prepend the Shared Context above.**
>
> **Surface.** `dashboard` — the primary product UI for a **customer tenant** (a business using
> jojo to send SMS). Domain `sms.<tenant>`. Auth: WorkOS SSO; roles are **owner / admin / member**.
> This is the app most users live in daily.
>
> **Primary personas.**
> - *Ops/marketing user* — composes and sends messages, watches delivery, checks balance.
> - *Account owner* — also cares about spend, top-ups, and team.
>
> **Design these screens (with all four global states each):**
>
> 1. **Overview / Home** — at-a-glance: current **wallet balance** (big, exact, per-currency if the
>    tenant holds more than one), a **low-balance warning** state, today's send volume + delivery
>    rate, recent messages, a prominent "Send SMS" and "Top up" action. This is the trust anchor —
>    money and deliverability up front.
> 2. **Send SMS (compose)** — recipient(s) in **E.164** (+233…, +234…), sender ID, message body
>    with a **live segment + encoding counter** (GSM-7 vs UCS-2; 1 segment = 160 GSM-7 / 70 UCS-2
>    chars; show segment count and **estimated cost** updating as they type — cost = segments ×
>    per-segment rate in the tenant's currency). Show a **cost-before-send confirmation**. Design the
>    **insufficient-balance (402)** state that blocks send and routes to top-up.
> 3. **Messages (log)** — dense, filterable table: recipient (masked), status, segments, cost,
>    created time, provider. **8-state status model** — design distinct, non-color-only chips for:
>    `queued`, `sending`, `accepted`, `sent`, `delivered`, `undelivered`, `failed`, `expired`.
>    Row → **message detail drawer**: full status timeline (the delivery-report / DLR history,
>    out-of-order tolerant), cost breakdown, and — when failed/undelivered — the reason + `request_id`.
> 4. **Wallet / Billing** — balance per currency, **top-up flow** (enter amount → payment provider
>    handoff → pending → credited), and a **ledger/transactions history** (top-ups, sms charges,
>    refunds) with running balance. Refunds and reversals must be legible as first-class entries.
>    Design a **low-balance alert** settings affordance (threshold).
> 5. **Team & settings** — members with roles (owner/admin/member), invite flow, and (declared, can
>    be lightweight) an **org switcher** for users who belong to more than one tenant.
>
> **Key components:** balance card, segment/cost meter, status chip set (8 states), message-detail
> timeline, money-precise transaction table, top-up modal, insufficient-funds block, role badges.
>
> **Deliverable:** high-fidelity prototype of the 5 screens in light + dark, at desktop and mobile
> widths, with the brand-anchor swap demonstrated. Show the send flow as a click-through
> (compose → cost confirm → sent → appears in log).

---

## PROMPT 2 — `dev-portal` (customer realm · the developer experience)

> **Prepend the Shared Context above.**
>
> **Surface.** `dev-portal` — where a **developer** at a customer tenant integrates jojo's API.
> Domain `developers.<tenant>`. Same customer WorkOS realm as the dashboard, but a distinct app with
> a distinct job: **credentials, documentation, and testing**. Reference the polish of Stripe's and
> Twilio's developer dashboards.
>
> **Primary persona.** *Integrating developer* — needs an API key, wants to read the reference, test
> a send, and wire up a webhook, fast.
>
> **Design these screens (with all four global states each):**
>
> 1. **API keys** — list of keys showing **prefix** (`sk_test_ab3d…`), environment badge
>    (**test** vs **live**), scopes, status (active/revoked), created + last-used. **Create-key flow
>    where the full secret is shown EXACTLY ONCE** — design the one-time reveal with copy + an
>    unmistakable "you won't see this again" affordance, then the masked resting state. Revoke with
>    confirmation. Make test-vs-live visually unmistakable (sandbox keys are safe; live keys spend
>    real money).
> 2. **API reference / docs** — an OpenAPI-driven reference (endpoints: send SMS, message status,
>    wallet, webhooks). Three-pane developer-docs layout (nav / content / code samples). Code samples
>    with a **language switcher** (cURL, Node, Python) and the developer's **test key rendered inline**
>    (fetched fresh per session — never cached). "Try it" affordance.
> 3. **Webhook management** — register endpoint URLs for delivery reports (DLR) + inbound messages,
>    show signing secret, and a **webhook tester** that sends a sample event to the registered
>    endpoint and shows the request/response + delivery status. (The tester only fires to
>    **registered** URLs — design it so that constraint is visible, not a free-form URL field.)
> 4. **Logs / API requests** — recent API calls: method, endpoint, status code, `request_id`,
>    timestamp, latency. Row → detail with request/response envelope. This is the developer's
>    debugging surface; the `request_id` ties back to error toasts elsewhere.
>
> **Key components:** key row + environment badge, one-time-secret reveal, three-pane docs shell,
> language-switching code block, webhook endpoint card + test-run result, request-log table.
>
> **Non-negotiables to reflect in the design:** the once-only secret reveal; test/live separation;
> "registered endpoints only" for the tester; `request_id` everywhere.
>
> **Deliverable:** high-fidelity prototype of the 4 screens, light + dark, desktop + tablet. Show the
> create-key click-through (create → one-time reveal → masked list row).

---

## PROMPT 3 — `admin-console` (staff realm · the control plane)

> **Prepend the Shared Context above.**
>
> **Surface.** `admin-console` — the **internal platform operations** console for jojo **staff**
> (support, ops, finance, trust & safety). Domain `admin.*`, a **separate, isolated auth realm** from
> customers (its own IdP org, its own session). This tool has power over tenants and money, so the
> design must make **authority, accountability, and reversibility** legible — every consequential
> action is logged, and dangerous ones are gated. Aesthetic: serious, dense, "mission control," a
> notch more utilitarian than the customer apps; the brand anchor is jojo's own (not white-labeled).
>
> **Primary personas.** *Support agent*, *Ops/finance operator*, *Trust & safety reviewer*.
>
> **Design these screens (with all four global states each):**
>
> 1. **Tenants list + tenant detail** — search/filter all customer tenants: name, plan, status
>    (active / suspended / closed), balance, region, created. Detail view: account health, wallet
>    balances, recent activity, members, and admin actions (suspend, adjust plan, **soft-close** —
>    never hard-delete).
> 2. **Maker-checker queue** — sensitive changes (manual wallet adjustments, plan changes, refunds)
>    require **propose → approve by a second operator**. Design the queue: pending proposals, who
>    proposed, what changes (a clear **before → after diff**), approve/reject with reason. The two-person
>    rule must be obvious in the UI.
> 3. **Impersonation** — an operator can act as a tenant to debug, but it is **time-boxed and
>    never-silent**. Design: the start-impersonation flow (requires a **reason**, shows a countdown),
>    and — critically — the **persistent, unmissable banner** shown for the entire impersonation
>    session ("You are viewing as <tenant> · ends in 14:32 · end now"). This banner is a safety
>    feature; make it impossible to forget you're impersonating.
> 4. **Kill-switch / controls** — platform + per-tenant operational switches (e.g. pause sending for
>    a tenant, disable a provider). Dangerous toggles with confirmation + reason + audit note. Design
>    the "are you sure, this affects live traffic" gate.
> 5. **Audit log** — an immutable, filterable record of every admin action: actor, action, target,
>    before→after, reason, timestamp. Support drill-down from any entity into "what happened here."
>
> **Key components:** tenant table + health detail, maker-checker proposal card with before→after
> diff, step-up-auth challenge (re-authenticate before a dangerous action), impersonation start
> dialog + persistent banner with countdown, destructive-action confirm gate, audit timeline.
>
> **Non-negotiables to reflect in the design:** two-person maker-checker; never-silent impersonation
> banner; step-up auth before destructive/financial actions; reason-required + audited on every
> consequential action; soft-close (no hard delete).
>
> **Deliverable:** high-fidelity prototype of the 5 screens, light + dark, desktop-first. Show the
> maker-checker click-through (propose adjustment → second operator approves) and the impersonation
> banner in an active state.

---

## Handoff notes

- These are **prototype** prompts — visual + interaction design, not production code. The built apps
  will consume `packages/ui` tokens and the `@app/contracts` data shapes; the prototypes just need to
  be faithful to the domain (statuses, currencies, key formats, the safety affordances).
- Suggested order to prototype: **dashboard** (the product) → **dev-portal** (adjacent, shares realm)
  → **admin-console** (separate realm, most safety-critical).
- When the prototypes land, PI-2 build sequencing (fe-auth seam wiring → BFF per app → screens) gets
  scoped against them.
