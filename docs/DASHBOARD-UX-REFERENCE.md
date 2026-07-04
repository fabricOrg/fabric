# Fabric — Dashboard & UI/UX Design Reference

> **Date:** 2026-07-04 · **Author:** Product (fifi) · **Status:** research-backed design reference
> **Companion to** [`COMPETITIVE-ANALYSIS.md`](./COMPETITIVE-ANALYSIS.md) (features/market). This doc is the **design/UX layer** — how to build the dashboards, not what features to ship.
> **Method:** multi-agent deep-research — 6 angles, 27 sources, 111 claims, top 25 adversarially verified (3-vote). **22 confirmed, 3 refuted.** Each recommendation tags its verification vote; items with no citation are labelled **[best-practice]** (general UX, not a verified competitor precedent).
> **Source honesty:** most competitor-UI claims are **first-party** (vendor blogs/docs) — authoritative for "how they designed their own UI" but written in marketing register (design *intent*, not audited usability). WCAG is the only fully primary-standard finding. See §6 for coverage gaps.

---

## 0. Headline

Best-in-class CPaaS + developer-SaaS dashboards in 2026 converge on a small, hard pattern set:

1. **Module/product IA** with a **combined persistent sidebar + topbar** (Twilio, Infobip). `3-0`
2. **Two explicit switchers** — product switcher *and* account/tenant switcher (Twilio, Bird). `3-0`
3. **A single "developer workbench"** co-locating API keys, webhooks, logs, alarms (Twilio). `3-0`
4. **Once-only API-secret reveal** for security (Clerk). `3-0`
5. **Observability split into purpose-specific tabbed dashboards** with rich multi-dimensional filtering (Twilio Messaging Insights' six views). `3-0`
6. **Keyboard-first, local-first feel** — ⌘K palette over an in-memory pool, optimistic updates (Linear). `3-0`
7. **Credit-free sandbox/test mode** that simulates API behavior incl. delivery callbacks (Arkesel). `2-1`
8. **WCAG 2.2 AA** as the non-negotiable floor. `3-0`

**Good news:** three of these (dev-workbench grouping, once-only reveal, org switcher) **validate designs Fabric already has** — the dev-portal and admin console are on the right track. The gaps are mostly on the *product* dashboard (tabbed observability, command palette, sandbox, unified overview) and Africa-specific reach.

---

## 1. Global IA & navigation patterns

| # | Pattern | Priority | Fabric status | Precedent (vote) |
|---|---|---|---|---|
| **N-1** | **Combined sidebar + topbar, organized by product/module** — high-priority actions at top level, lower-priority nested. Per-product sidebar variants (disclosures vs icon-only collapse). | **P0** | Sidebar exists (Messaging/Account groups); add topbar role + module framing | Twilio combined-nav `3-0`; Infobip Portal 2.0 Target/Communicate/Analyze modules `3-0` |
| **N-2** | **Two distinct switchers**: (a) **account/tenant/workspace switcher** (swap orgs — the one that matters most for Fabric's multi-tenancy), (b) product switcher (move across products, e.g. Messaging↔Payments↔Identity) | **P0** | Org switcher present in Team screen — promote to global topbar; add product switcher as product surface grows | Twilio Account+Product switchers `3-0`; console switcher (no separate logins) `3-0` |
| **N-3** | **Dynamic home + global search** on login — surface the products/resources the user needs, searchable | **P1** | Overview exists; add global search | Twilio new Console `3-0` |

> Note: Twilio's *Product* Switcher is described as aspirational in their kit; the *Account* Switcher is the shipped, Fabric-relevant one. Infobip's "always-visible nav" was a `2-1` (preview framing) but the module IA is corroborated by live docs.

---

## 2. Per-screen recommendations (mapped to Fabric's actual screens)

### Overview (home)
- **[S-1] Unify observability + billing/usage into one at-a-glance dashboard** — traffic, expenses, delivery rate, recent activity. **P1.** Precedent: Infobip Analyze central dashboard (traffic/delivery-rate/failed + expense-by-country/network/channel). `3-0`
- **[S-2]** Dynamic, role-aware home with global search (see N-3). **P1.**

### Send / compose (multi-recipient)
- **[S-3]** Keep the cost-estimate + balance-after-send + inline-confirm pattern (already built) — it's ahead of most competitors. **[best-practice]** — no verified competitor precedent survived; treat as a Fabric strength to preserve.
- **[S-4]** Add a **test/sandbox send** path from the compose screen (credit-free) — see D-3. **P1.**

### Messages log + delivery timeline
- **[S-5] Split analytics from the raw log** — a purpose-tabbed observability surface (Overview · Delivery & Errors · Responses · OTP Conversion · Scheduled), separate from the message table. **P0/P1.** Precedent: Twilio Messaging Insights' six discrete tab dashboards. `3-0`
- **[S-6] Rich multi-dimensional filtering** on the log: time range, channel, carrier, country, delivery status, error code, sender/number, sub-account. **P0.** Precedent: Twilio's verbatim filter set. `3-0`
- **[S-7]** Delivery-timeline drawer (already built) is the right detail-drawer pattern — keep; ensure per-error-code frequency + doc-link affordance (from feature doc A-3). **P1.**

### Wallet & billing
- **[S-8]** Fold usage/cost observability into the wallet view (spend by channel/country), per Infobip's expense reporting. **P1.** `3-0`
- **[S-9]** Currency display must be locale-correct for GHS/NGN/USD (symbol, grouping, minor units). **P1.** [best-practice + MS globalization primary] — Fabric already uses exact bigint minor-units + `formatMoney`, so this is a display-layer confirm.

### Team / org switcher
- **[S-10] One Users table** showing role assignments + workspace access + account status, with per-user detail/edit pages. **P0.** Precedent: Bird (ex-MessageBird) Organization Settings Users page. `3-0`

### Admin / control-plane (Tenants · Maker-checker · Impersonation · Kill-switch · Audit)
- **[S-11]** The tenant/account switching + status model maps to N-2's account switcher; impersonation banner (already built, never-silent) is a strong pattern — keep. **[best-practice]** — no verified competitor admin-console precedent survived (coverage gap §6).

---

## 3. Developer-portal UX patterns

| # | Pattern | Priority | Fabric status | Precedent (vote) |
|---|---|---|---|---|
| **D-1** | **Single developer workbench** — API keys + webhooks + logs + alarms co-located (Overview/Debugger/Alarms tabs), not scattered per product | **P0** | dev-portal already groups keys/webhooks/logs — **validated**; add alarms/alerting tab | Twilio new Console workbench `3-0` |
| **D-2** | **Once-only API-secret reveal** — secret shown only in the create response, never retrievable; lose it → rotate | **P0** | **Already built** ("You won't be able to see this again") — **validated against Clerk** | Clerk API-keys docs `3-0` |
| **D-3** | **Credit-free sandbox / test mode** simulating real API behavior incl. delivery callbacks — reach first-integration before paying | **P1** | Not yet (FakeProvider exists backend-side — surface it as a user-facing test mode) | Arkesel sandbox `2-1` (credit-free core solid; simulated-DLR detail vendor-asserted) |
| **D-4** | **Test-vs-live mode toggle** in the dev surface | **P2 [best-practice]** | Not yet | ⚠️ The Stripe "top-left toggle" claim was **refuted `0-3`** — no cited precedent survived. Implement per general convention, don't cite Stripe. |

---

## 4. Cross-cutting quality bar

| # | Dimension | Priority | Detail |
|---|---|---|---|
| **Q-1** | **WCAG 2.2 AA** — 4.5:1 text / 3:1 large-text · **3:1 non-text contrast for UI components AND chart/graphical objects** (constrains data-viz + dark-mode palettes) · full keyboard operability, no keyboard traps (palettes, data tables) | **P0** | W3C primary `3-0`. Fabric already hardened AA (adams' axe QA); the **3:1 chart/non-text** rule is the one to watch when building observability data-viz. |
| **Q-2** | **Keyboard-first + local-first feel** — ⌘K command palette making the whole app reachable from one pane; optimistic updates so UI never blocks on network | **P1** | Linear `3-0`. shadcn ships a Command primitive — low cost to adopt. `~ms vs ~300ms` figure is illustrative. |
| **Q-3** | **Empty / loading / error / notification states** + responsive/mobile + design-system consistency | **P1 [best-practice]** | No verified precedent survived (coverage gap). Apply general best-practice: skeletons, actionable empty states, toast/alert hierarchy. Fabric's shadcn + Palette A design system already gives consistency. |
| **Q-4** | **Data-viz specifics** (chart types, color encoding, delivery-timeline viz) | **P1 [best-practice]** | Beyond Twilio's tabbed structure, no verified specifics. Follow the repo's `dataviz` guidance; ensure encodings meet Q-1's 3:1 in both themes. |

---

## 5. Africa-specific UX considerations

| # | Consideration | Priority | Detail (vote) |
|---|---|---|---|
| **A-1** | **Don't ship smartphone-app-only** — plan low-bandwidth / feature-phone-accessible flows; USSD is required for mass-market reach | **P1/P2** | Nigeria's eNaira launched smartphone-only and *"excluded feature phone users and people in areas without Internet"*; USSD (`*997#`) was added later for inclusion. `3-0` (USSD-upgrade framing `2-1`, now stale/live — reinforces the lesson). Ties to feature-doc C-4 (USSD channel). |
| **A-2** | **Low-data dashboard mode** — lightweight assets, avoid heavy client bundles for operators on constrained connectivity | **P2 [best-practice]** | General low-bandwidth design; pairs with Q-2 local-first. |
| **A-3** | **Locale-correct currency/number formatting** for GHS/NGN/USD | **P1** | MS globalization (primary) + best-practice. Confirm symbol/grouping/minor-unit display per locale. |

---

## 6. Caveats, refuted claims & coverage gaps

**Refuted (do NOT cite these):**
- Stripe test/live toggle top-left placement — **`0-3`**. No cited precedent for a test-vs-live toggle; D-4 is best-practice only.
- Arkesel per-environment scoped keys — `0-3`.
- Arkesel multi-language API-reference code samples — `0-3`.

**Weak-vote / framing caveats:**
- Infobip persistent nav `2-1` (preview framing); Twilio Product Switcher is aspirational (Account Switcher is real); Arkesel "simulates delivery callbacks" is vendor-asserted; Linear perf figures are illustrative blog-grade; eNaira "planned USSD" framing is time-stale (live in 2026).

**Coverage gaps (treat as best-practice, not cited precedent):**
- **No verified claims survived for:** Vercel, Supabase, Vonage, Sinch, **Termii, Hubtel, Africa's Talking dashboards** (AT pages returned unreliable/blocked to the fetcher), or for command-palette/dark-mode/empty-state patterns beyond Linear.
- African-competitor dashboard specifics (wallet/credit-balance, sender-ID/short-code management, low-bandwidth) are a **known gap** — a targeted follow-up (or hands-on account walkthroughs) would close it.

**Open questions worth a follow-up pass:**
1. Cited precedent for sandbox/test-mode toggle placement & labeling (Stripe current UI / Supabase / Clerk).
2. How African players (AT, Termii, Arkesel, Hubtel) design wallet, sender-ID/short-code, and low-bandwidth screens.
3. Cited standards for empty/loading/error/notification states + responsive dashboard behavior.
4. Data-viz specifics for CPaaS observability adapted to WCAG 3:1 in dark mode.

---

## 7. Sources

Primary (highest weight):
- Twilio — new Console: https://www.twilio.com/en-us/blog/products/launches/new-twilio-console
- Twilio — product-suite cohesion (nav IA): https://www.twilio.com/en-us/blog/developers/bringing-cohesion-to-the-twilio-product-suite-part-ii
- Twilio — Messaging Insights dashboards: https://www.twilio.com/docs/messaging/features/messaging-insights/dashboards
- Infobip — Portal 2.0 preview: https://www.infobip.com/news/portal-preview-the-next-generation-of-customer-interaction
- Bird (ex-MessageBird) — updates/changelog: https://bird.com/en-us/updates
- Clerk — API keys (once-only reveal): https://clerk.com/docs/guides/development/machine-auth/api-keys
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- MS globalization — currency formats: https://learn.microsoft.com/en-us/globalization/locale/currency-formats
- Arkesel — developer API/sandbox: https://arkesel.com/developer-api/

Secondary / blog:
- Linear performance breakdown: https://performance.dev/how-is-linear-so-fast-a-technical-breakdown
- eNaira / USSD inclusion: https://techpoint.africa/insight/enaira-ecedi-cbdc/
- Infobip web design case study: https://medium.com/distant-horizons/case-study-infobip-web-design-and-development-953fbdc4d8da
- SaaS onboarding best-practice set: appcues.com, productled.com, candu.ai, userlist.com, context.dev, flowjam.com
- Dashboard design best-practice: pencilandpaper.io, 5of10.com; low-bandwidth: launchpad.ng
