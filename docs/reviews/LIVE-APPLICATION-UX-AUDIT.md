# Live Application UX Audit

Audit date: 2026-07-11  
Environment: local authenticated workspace, Fabric dark theme  
Requested viewports: 1440x900, 900x800, 390x844

## Executive Summary

The Customer Dashboard has a coherent WorkOS-inspired shell, credible operational copy, and strong task-oriented grouping, but it is not ready for unrestricted release. The most serious observed product defect is horizontal clipping at the requested 1440px desktop viewport on core financial, messaging, and journey-building surfaces. The most serious audit/release defect is that the Developer Portal and Admin Console accept connections on ports 3200 and 3300 but do not return either their application pages or `/healthz`; both remained unavailable after their local frontend processes were restarted. Those applications therefore fail the most basic availability UAT and could not be honestly certified for visual, responsive, keyboard, dialog, or workflow quality.

This report separates three evidence classes:

- **Observed live**: rendered and inspected in the authenticated in-app browser.
- **Observed unavailable**: navigation and health requests stalled against a listening local service.
- **Route inventory only**: a route exists in the workspace, but its UI was not rendered; no visual claim is made.

Release recommendation: **No-go** until the two unavailable applications render reliably and the dashboard's systemic horizontal overflow is fixed. After that, repeat the full responsive and interaction matrix before backlog implementation is considered complete.

Highest-priority findings:

1. **Blocker — Developer Portal and Admin Console unavailable.** Ports listen, but pages and health endpoints do not respond. This blocks the developer and staff journeys completely.
2. **High — Core dashboard pages overflow at 1440px.** Important content and actions are clipped to the right on Send SMS, Wallet & Billing, and Journeys.
3. **High — Journeys looks production-capable but is not present in dashboard navigation and exposes a large, partially off-canvas editor.** Its release state and stakeholder promise are unclear.
4. **High — Campaigns can remain as a full table-shaped skeleton without visible timeout, error explanation, or retry.** The state is indistinguishable from a slow request.
5. **Medium — Shell controls and sidebar rows are frequently below a 44px touch target.** The 32px navigation rows are efficient on desktop but unsuitable as the unchanged mobile interaction model.

## Cross-Application Findings

### Blocker — Two applications fail availability and auditability

- URLs: `http://localhost:3200/*`, `http://localhost:3300/*`
- Stakeholders: integration developers; Fabric operators and admins.
- Job/value: access API credentials and diagnostics; operate tenant, approval, safety, and audit workflows.
- Actual value/clarity: none while no response is returned.
- Decision: **Improve**.
- Recommendation: make `/healthz` respond independently of identity/data dependencies, expose a bounded loading/failure screen, capture server diagnostics, and add a three-app local-stack smoke check. Do not treat a listening socket as healthy.
- Severity: **Blocker**.

### High — Content width is not constrained to the available shell viewport

- Observed on: Dashboard Send SMS, Wallet & Billing, Journeys; adjacent risk on other two-column pages.
- Actual behavior: right-hand panels and text extend beyond the 1440px viewport. Wallet payment-method copy is cut off; Send SMS review panels are mostly off-screen; Journeys' configuration panel is positioned beyond the viewport.
- Recommendation: calculate layout from the post-sidebar content area, apply `min-width: 0` to grid/flex children, cap page width consistently, and collapse multi-column layouts before they clip. Horizontal scrolling should be intentional and local to tables/canvases, never the page shell.
- Severity: **High**.

### Medium — Shell interaction density conflicts with touch accessibility

- Observed: sidebar navigation rows are approximately 32px high; the top sidebar toggle is approximately 28px square; the rail collapse affordance is narrow.
- Recommendation: preserve the compact visual size while expanding the interactive hit area to at least 44x44px, with visible keyboard focus and tooltips for icon-rail items.
- Severity: **Medium**.

### Medium — Breadcrumbs are consistent but redundant

- Observed dashboard pattern: `Dashboard > [current page]`, even when the shell already announces “Dashboard.”
- Recommendation: use the Fabric workspace/tenant as the root only when it provides useful navigation; otherwise render a single current-page breadcrumb on leaf pages and reserve multi-level breadcrumbs for real hierarchy (for example Campaigns > New campaign).
- Severity: **Medium**.

### Medium — Preview/capability labeling is inconsistent

- Campaigns is explicitly labeled “Preview”; Journeys is accessible by URL and visually production-ready but absent from navigation.
- Recommendation: define one lifecycle pattern: Preview badge + scope statement + feedback path + non-production-data warning where applicable. Hidden routes must not look fully shipped.
- Severity: **Medium**.

## Customer Dashboard

### Overview

- URL: `http://localhost:3100/`
- Evidence: **Observed live**.
- Stakeholder/JTBD: tenant owner or operator checking activation, traffic, delivery, spend, balance, and recent events.
- Value: high; the activation checklist provides a credible path to first delivery and the summary tiles support daily monitoring.
- Value clarity: clear. Primary actions (“Send”, “New campaign”, “Verify number”) are visible, but three equally weighted actions dilute the single next step.
- Navigation: correct; profile identity is clickable in the sidebar and a separate account-menu button appears in the header.
- Layout/type: strong hierarchy and useful density; chart and activity sections are visually coherent.
- Decision: **Improve** — make the incomplete activation step the dominant CTA, demote secondary actions, and avoid duplicate profile affordances unless the menu and profile link have clearly distinct purposes.
- Severity: **Medium**.

### Transactions

- URL: `http://localhost:3100/flows`
- Evidence: **Observed live**.
- Stakeholder/JTBD: finance/operations user reconciling activity and running balances.
- Value: high when records are understandable and reconcilable.
- Primary action: inspect/filter/export; ensure export is colocated with the ledger and not duplicated with Wallet.
- Table quality: keep table height stable across loading, true-empty, filtered-empty, and error states; localize horizontal scrolling; keep running balance and amount columns tabular and right-aligned.
- Decision: **Improve** — distinguish messaging delivery “transactions” from wallet ledger transactions in navigation, or merge them if they describe the same business object.
- Severity: **Medium**.

### Send SMS

- URL: `http://localhost:3100/send`
- Evidence: **Observed live**.
- Stakeholder/JTBD: operations user sending an immediate message to one or more recipients.
- Value: strong; recipient validation, opt-out handling, sender selection, personalization, review, and exact-cost promise are the correct pre-send safeguards.
- Primary action: send after review; currently the review/cost column is clipped beyond the right edge at 1440px, so the safety gate is not reliably visible.
- Form quality: visible labels are good. Preserve paste, explain E.164 with an example, focus the first invalid field, retain entered recipients/content after recoverable errors, and show disabled/submitting state only after the request begins.
- Financial/destructive safety: the final send needs an explicit recipient/segment/cost confirmation when volume or cost crosses a defined threshold.
- Decision: **Improve** — stack review beneath compose at constrained desktop widths; make the final confirmation sticky within the content column, not off-canvas.
- Severity: **High**.

### Campaigns

- URL: `http://localhost:3100/campaigns`
- Evidence: **Observed live**.
- Stakeholder/JTBD: lifecycle/marketing operator managing bulk scheduled sends.
- Value: potentially high, but explicitly preview.
- Actual state: the captured page remained a table-shaped skeleton with no visible timeout, error explanation, retry, or preview limitation copy.
- Table quality: loading reserves space well, but a persistent skeleton is not a recovery state. True empty should teach creation; filtered empty should preserve filters and offer clear/reset; error should name the failed data and offer retry.
- Decision: **Improve** — add a bounded loading transition, explicit recoverable error, preview scope, and a visible “New campaign” primary action.
- Severity: **High**.

### New Campaign

- URL: `http://localhost:3100/campaigns/new`
- Evidence: **Observed live**.
- Stakeholder/JTBD: campaign operator composing, reviewing, and scheduling a compliant bulk send.
- Value: high only if review includes sender, audience, exclusions, segment count, estimated cost, timezone, and final schedule.
- Form quality: preserve draft state, warn before navigation with unsaved changes, validate audience before scheduling, and provide recovery without losing content.
- Decision: **Improve** — use a staged Compose → Audience → Review & schedule flow with a persistent summary; never let “Schedule” bypass cost and quiet-hours checks.
- Severity: **High**.

### Messages

- URL: `http://localhost:3100/messages`
- Evidence: **Observed live**.
- Stakeholder/JTBD: support/operations user tracing a send, delivery status, provider timeline, and cost.
- Value: high and directly supports first-delivery confirmation.
- Table quality: row actions/details must be discoverable without relying only on a hidden kebab; recipient masking is appropriate, while request/provider IDs should live in an expandable technical details section with copy controls.
- Decision: **Improve** — deep-link row detail in the URL, preserve filter state, and distinguish “no messages yet” from “no matches.”
- Severity: **Medium**.

### Number Verification

- URL: `http://localhost:3100/verify`
- Evidence: **Observed live**.
- Stakeholder/JTBD: product/developer operator testing OTP verification configuration and conversion.
- Value: clear if it is a real channel capability; risky if the “test” surface can be mistaken for live traffic.
- Decision: **Improve** — label sandbox/test scope at the action, state whether charges apply, and provide deterministic resend/expiry/error recovery.
- Severity: **Medium**.

### Sender IDs

- URL: `http://localhost:3100/senders`
- Evidence: **Observed live**.
- Stakeholder/JTBD: tenant owner/admin registering branded senders and tracking carrier approval.
- Value: essential to activation and compliance.
- Table/form: explain statuses and next action; a rejected record needs rejection reason, editable resubmission, and document retention guidance. Registration must not imply immediate approval.
- Decision: **Keep and improve** — make rejection recovery a first-class row action and link the activation checklist directly to the relevant status.
- Severity: **High**.

### Consent & DND

- URL: `http://localhost:3100/consent`
- Evidence: **Observed live**.
- Stakeholder/JTBD: compliance/operations user configuring classifications, quiet hours, and tenant opt-outs.
- Value: high; directly reduces regulatory and reputational risk.
- Interaction: quiet-hours inputs need explicit timezone and overnight-range semantics. Add/remove opt-out actions need confirmation or undo, audit visibility, and normalization feedback.
- Table states: distinguish global/provider DND from tenant-managed opt-out and explain when removal does not make a recipient legally sendable.
- Decision: **Keep and improve** — group policy, quiet hours, and recipient exceptions in a clear compliance hierarchy; do not imply that removing an app-level opt-out overrides external DND.
- Severity: **High**.

### Wallet & Billing

- URL: `http://localhost:3100/wallet`
- Evidence: **Observed live**.
- Stakeholder/JTBD: owner/finance user understanding balance, funding, auto-top-up, payment method, and ledger history.
- Value: high and mostly clear.
- Actual defect: the right column exceeds the 1440px viewport; payment-method content is clipped. The page combines several large cards and a ledger, creating excessive vertical travel and nested-card weight.
- Financial safety: top-up and auto-top-up require explicit amount/currency, payment rail, thresholds/limits, confirmation, idempotent progress, receipt, and failure recovery. Never activate recurring funding from a single ambiguous click.
- Decision: **Improve** — constrain the grid, prioritize available balance + primary Top up, move settings into a compact billing-settings section, and keep transaction history full width.
- Severity: **High**.

### Team

- URL: `http://localhost:3100/team`
- Evidence: **Observed live**.
- Stakeholder/JTBD: owner/admin inviting members, understanding roles, and managing access.
- Value: essential for delegation and least privilege.
- Form/table: role descriptions must be visible at invitation time; row actions must expose current role and restrictions. Removal and privilege reduction need confirmation; self-removal/last-owner cases must fail closed with a useful explanation.
- Decision: **Keep and improve** — add concise permission summaries, pending-invite state/actions, and last-owner safeguards.
- Severity: **High**.

### Profile

- URL: `http://localhost:3100/profile`
- Evidence: **Observed live**.
- Stakeholder/JTBD: any authenticated user confirming identity/session and accessing sign-out or personal preferences.
- Value: clear only for user-owned settings; tenant role and organization membership should be visible but not editable here.
- Navigation: sidebar identity correctly links to the page; header account menu duplicates entry and should clarify its faster actions.
- Decision: **Keep** — show WorkOS-managed identity as read-only, tenant role, workspace, session/security link, theme preference, and sign-out.
- Severity: **Low**.

### Go Live

- URL: `http://localhost:3100/go-live`
- Evidence: **Observed live**.
- Stakeholder/JTBD: owner/admin submitting business/compliance information to move from sandbox to live traffic.
- Value: critical commercial conversion path.
- Workflow: entry should be available from a persistent sandbox banner and Overview checklist. Submission must show requirements, ownership, progress, immutable audit history, expected review time, and safe resubmission after rejection.
- Decision: **Improve** — model explicit Draft → Submitted → In review → Approved/Rejected states; rejection must show field-level reasons and retain prior answers/documents.
- Severity: **High**.

### Journeys

- URL: `http://localhost:3100/journeys`
- Evidence: **Observed live; route is not in the dashboard sidebar**.
- Stakeholder/JTBD: automation operator building multi-channel communication workflows.
- Value: potentially strategic, but far beyond the mental model and maturity of the adjacent messaging surfaces.
- Actual defects: no visible page `h1`; large editor extends beyond the viewport; configuration panel begins off-canvas; icon rail lacks labels in collapsed state; “Draft/Reset/Save/Publish” conveys production capability without preview labeling or navigation placement.
- Accessibility: canvas keyboard instructions exist, which is positive, but node/edge focus, zoom, connection creation, error navigation, and mobile alternatives require dedicated UAT. This is not a viable mobile editing experience.
- Decision: **Defer/relocate** — keep behind an explicit Labs/Preview entry or feature flag until lifecycle, save/publish safety, undo/history, responsive read-only mode, and capability support are defined.
- Severity: **High**.

## Developer Portal

All routes below were inventoried but the live application was **unavailable**. Visual, responsive, keyboard, menu, table, form, empty/error, and dialog claims are intentionally withheld.

### Developer Overview / API Keys

- URL: `http://localhost:3200/`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: developer creating and rotating credentials and finding the next integration step.
- Decision: **Improve availability first**; once rendered, key creation must show the secret once, support copy confirmation, scopes, environment, last-used metadata, rotation/revocation confirmation, and never expose full secrets again.
- Severity: **Blocker**.

### API Reference

- URL: `http://localhost:3200/reference`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: developer learning authenticated request/response contracts.
- Decision: **Keep pending live audit** — clearly label generated/static reference freshness, environment base URLs, errors, idempotency, rate limits, and copy-safe examples without real keys.
- Severity: **Blocker** (availability); **Medium** residual UX risk.

### Webhooks

- URL: `http://localhost:3200/webhooks`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: developer configuring endpoints and diagnosing delivery/retry behavior.
- Decision: **Keep pending live audit** — require HTTPS validation, secret handling, event selection, test-delivery clarity, signature docs, delivery history, retry, disable/delete confirmation, and no fake-success preview.
- Severity: **Blocker**.

### Logs

- URL: `http://localhost:3200/logs`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: developer finding a request and understanding status, latency, error, and correlation details.
- Decision: **Keep pending live audit** — URL-backed filters, true/filtered empty distinction, stable table height, localized overflow, row/detail deep links, copyable request IDs, redacted payloads, and retry guidance are mandatory.
- Severity: **Blocker**.

### Developer Profile

- URL: `http://localhost:3200/profile`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: developer understanding identity, tenant, role, and session.
- Decision: **Keep pending live audit**.
- Severity: **Blocker**.

## Admin Console

All routes below were inventoried but the live application was **unavailable**. Because these controls can change access, money-adjacent capability, and platform safety, absence of live maker-checker and confirmation testing is a release blocker.

### Admin Overview

- URL: `http://localhost:3300/`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: staff operator seeing operational workload, risk, and pending decisions.
- Decision: **Improve availability first**; overview should prioritize actionable queues and incidents, not vanity totals.
- Severity: **Blocker**.

### Tenants

- URL: `http://localhost:3300/tenants`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: staff finding and provisioning tenant organizations.
- Decision: **Keep pending live audit** — human-readable name/domain/status should lead; internal IDs should be secondary copyable metadata. Creation and status changes need confirmation and audit evidence.
- Severity: **Blocker**.

### Tenant Details

- URL pattern: `http://localhost:3300/tenants/[slug]`
- Evidence: **Route inventory only**; no safe slug was obtained from the unavailable list.
- Stakeholder/JTBD: staff understanding tenant identity, members, status, risk, and actions in context.
- Decision: **Keep pending live audit** — use a stable breadcrumb back to Tenants, preserve tenant context, separate read-only facts from dangerous actions, and never make raw IDs the page title.
- Severity: **Blocker**.

### Sender Approval

- URL: `http://localhost:3300/senders`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: operator reviewing evidence and approving/rejecting sender requests.
- Decision: **Keep pending live audit** — show tenant, requested sender, country/network scope, evidence, conflicts, maker/checker state, rejection reason, and irreversible-effect confirmation.
- Severity: **Blocker**.

### Maker-Checker

- URL: `http://localhost:3300/maker-checker`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: authorized checker independently validating sensitive proposals.
- Decision: **Keep pending live audit** — visually distinguish proposal from applied state, forbid self-approval, show before/after diff and rationale, and make rejection recoverable.
- Severity: **Blocker**.

### Impersonation

- URL: `http://localhost:3300/impersonation`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: support/admin diagnosing tenant experience under controlled access.
- Decision: **Improve pending live audit** — require tenant selection, reason, bounded duration, prominent persistent banner, immediate stop, audit record, and explicit prohibition/guardrails around financial and destructive actions.
- Severity: **Blocker**.

### Kill Switch

- URL: `http://localhost:3300/kill-switch`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: authorized staff stopping risky platform operations during an incident.
- Decision: **Keep pending live audit** — show blast radius and current effective state; require typed confirmation or maker-checker for activation changes; include reason, expiry/review time, last-known-good semantics, and audit trail.
- Severity: **Blocker**.

### Staff

- URL: `http://localhost:3300/staff`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: staff admin inviting and maintaining operator/admin access.
- Decision: **Keep pending live audit** — expose role meaning, invitation status, last activity, removal confirmation, and last-admin safeguards.
- Severity: **Blocker**.

### Audit Log

- URL: `http://localhost:3300/audit`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: compliance/security staff reconstructing who changed what, when, and why.
- Decision: **Keep pending live audit** — URL-backed filters, immutable event detail, actor/target human labels plus copyable IDs, before/after diff, correlation ID, export controls, and clear retention/timezone are required.
- Severity: **Blocker**.

### Plugins

- URL: `http://localhost:3300/plugins`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: platform admin configuring provider integrations/capabilities.
- Decision: **Relocate or clarify** — “Plugins” is implementation language unless staff genuinely manages pluggable providers. Rename to “Providers” or “Integrations,” separate secret entry from status, and require safe test/rollback behavior.
- Severity: **Blocker** (availability); **Medium** information-architecture risk.

### Admin Profile

- URL: `http://localhost:3300/profile`
- Evidence: **Observed unavailable; route inventory only**.
- Stakeholder/JTBD: staff user confirming identity, role, and session.
- Decision: **Keep pending live audit**.
- Severity: **Blocker**.

## Journey Findings

### A. First delivery

Path: Overview → Sender IDs → Billing & Wallet → Send SMS → Messages → Transactions.

- Strong: Overview explicitly teaches the activation sequence and links forward.
- High friction: Wallet and Send SMS clip critical right-side content at desktop width.
- Ambiguity: “Transactions” can mean delivery activity or financial ledger entries; the journey ends on a label that may not match the user's mental model.
- Recommendation: maintain a persistent activation progress state, carry approved sender and available balance forward, confirm the exact send cost, link success directly to message detail, then label the final reconciliation destination precisely.
- Severity: **High**.

### B. Sandbox-to-live

Path: Overview/sandbox banner → Go Live → submission/status/rejection recovery.

- Go Live exists, but the complete banner-to-rejection loop could not be safely forced without changing application data.
- Recommendation: test with seeded Draft, Submitted, In review, Approved, and Rejected tenants. Rejection must retain inputs and provide field/document-level remediation.
- Severity: **High**.

### C. Compliance

Path: Sender IDs → Consent & DND → quiet hours → opt-out filters/add/remove.

- The information architecture is sensible.
- Risk: removing a local opt-out can be misread as permission to override provider/regulatory DND.
- Recommendation: show source and authority for each suppression, timezone on quiet hours, and confirmation/undo plus audit evidence for changes.
- Severity: **High**.

### D. Team

Path: Team → invite → role visibility → member actions → profile.

- Team and Profile are findable; profile identity is clickable.
- Recommendation: role descriptions at invite time, pending-invite lifecycle, last-owner protection, and an explicit “Your role” line on Profile.
- Severity: **High**.

### E. Campaign

Path: campaign list → loading/empty/filter → new campaign → review/schedule.

- The live list remained in loading skeleton state; recovery was not presented.
- Recommendation: implement deterministic state fixtures/UAT controls for loading, true empty, filtered empty, error/retry, draft, review, schedule, and schedule failure.
- Severity: **High**.

### F. Developer

Path: API keys → API reference → Webhooks → Logs → request details.

- Entire journey blocked by Developer Portal availability.
- Recommendation: make this a required smoke/E2E journey after availability repair; use a sandbox key and seeded request/webhook delivery, never a live secret.
- Severity: **Blocker**.

### G. Admin

Path: Tenants → tenant detail → sender approval → maker-checker → impersonation → kill switch → staff → audit log.

- Entire journey blocked by Admin Console availability.
- Recommendation: seed a non-production staff dataset and exercise both maker and checker identities. Verify persistent impersonation banner, forbidden self-approval, kill-switch confirmation, role boundaries, and immutable audit evidence.
- Severity: **Blocker**.

## Accessibility Findings

1. **High:** clipped content creates unreachable or undiscoverable controls even before keyboard-specific testing.
2. **Medium:** dashboard sidebar rows and several icon controls are below the recommended 44x44px touch target.
3. **Medium:** the icon-only collapsed rail depends on icon recognition; every item needs an accessible name, tooltip, visible focus, and stable alignment.
4. **Medium:** Journeys has useful keyboard instructions for canvas elements, but no live evidence yet proves complete focus order, connection creation, error navigation, or escape behavior.
5. **Medium:** all async tables/forms need polite announcements for loading, validation, success, and failure; persistent skeletons need a named recovery state.
6. **Medium:** numerical tables/charts should use tabular numerals and not rely on color alone.
7. **Blocked:** complete keyboard traversal, contrast measurement, semantic heading audit, form-label audit, and screen-reader dialog behavior for Developer/Admin could not be tested while unavailable.

## Responsive Findings

- **Desktop 1440x900:** systemic horizontal clipping observed on core Dashboard pages. This fails the largest requested viewport and predicts more severe behavior below it.
- **Narrow 900x800:** live sweep was interrupted by the unresponsive applications before reliable evidence could be completed. Treat as unverified, not passed.
- **Mobile 390x844:** live sweep was interrupted before reliable evidence could be completed. Journeys should default to a read-only/unsupported editing state unless a deliberate mobile editor is designed.
- Required layout rule: 24px desktop gutters and 16px mobile gutters, measured inside the post-sidebar content viewport; one shared max-width token; `min-width: 0` for grid/flex children; page-level `overflow-x` prohibited except for deliberate canvas/table regions.

## Prioritized Backlog

| Priority | Severity | Decision | Backlog item | Acceptance evidence |
|---|---|---|---|---|
| P0 | Blocker | Improve | Restore Developer Portal and Admin Console response/health behavior | `/healthz` and authenticated root render within bounded timeout; three-app smoke passes |
| P0 | High | Improve | Fix dashboard shell/content overflow | No page-level horizontal scroll or clipped action at 1440, 900, or 390; local table/canvas overflow documented |
| P0 | High | Improve | Make Send SMS review and cost gate visible | Review, exclusions, segments, cost, and final action visible and keyboard reachable at all supported widths |
| P1 | High | Improve | Complete campaign state/recovery model | Loading timeout, true empty, filtered empty, error/retry, draft, review, schedule all UAT-pass |
| P1 | High | Improve | Complete Go Live rejection recovery | Seeded state matrix preserves data and gives field-level remediation |
| P1 | High | Improve | Harden compliance mutations | Timezone/source clarity, confirmation or undo, audit event, DND authority explanation |
| P1 | High | Improve | Harden Team role lifecycle | Permission summary, pending invite, privilege/removal confirmation, last-owner guard |
| P1 | High | Defer/relocate | Put Journeys behind explicit Labs/Preview gate | Clear lifecycle label, navigation placement, save/publish safety, desktop containment, mobile policy |
| P1 | High | Improve | Audit financial confirmations | Top-up and auto-top-up limits, explicit confirmation, idempotent progress, receipt/failure recovery |
| P1 | High | Improve | Execute admin safety UAT | maker/checker separation, impersonation guardrails, kill-switch blast radius, audit evidence |
| P2 | Medium | Improve | Standardize shell geometry | shared max width, 24/16 gutters, consistent breadcrumbs, 44px hit areas, rail tooltips/focus |
| P2 | Medium | Rename | Disambiguate Transactions and Plugins | user-language labels validated in navigation and breadcrumbs |
| P2 | Medium | Improve | URL-persist table/filter/detail state | filters, pagination, selected row/detail deep-link and restore correctly |

## Recommended Delivery Sequence

1. Repair Developer/Admin runtime health and add a three-frontend smoke gate.
2. Fix shared shell sizing, max-width, gutters, flex/grid minimum widths, and touch targets across all apps.
3. Correct the core activation path: Sender IDs, Wallet, Send SMS, Messages, Transactions.
4. Complete campaign and Go Live state machines, including error/rejection recovery.
5. Harden compliance, team, financial, and staff destructive-action confirmations with audit evidence.
6. Decide Journeys lifecycle and navigation placement before further polish.
7. Run the complete 1440/900/390 visual, keyboard, and state matrix with seeded deterministic fixtures.
8. Only then address copy, breadcrumb reduction, density, and minor consistency polish.

## UAT Scenarios

1. **Three-app availability:** cold-start local stack; each `/healthz` responds and each authenticated root renders without indefinite loading.
2. **Responsive shell:** visit every route at 1440x900, 900x800, and 390x844; no page-level horizontal scroll, overlap, clipped action, or sub-16/24px gutter.
3. **Sidebar:** expand/collapse; icons remain centered; tooltips and accessible names appear; focus order is stable; profile remains reachable.
4. **First delivery:** start with no approved sender and insufficient balance; complete approval/funding fixtures, send, inspect delivery, and reconcile cost without losing context.
5. **Send failure:** invalid recipients, all recipients opted out, provider failure, insufficient wallet, duplicate submit, and expired session each recover without data loss or double charge.
6. **Campaign states:** verify loading, true empty, filtered empty, error/retry, draft resume, unsaved-navigation warning, review, quiet-hours adjustment, schedule, and schedule failure.
7. **Go Live:** verify every lifecycle state; rejection identifies exact remediation and resubmission retains valid prior data.
8. **Consent:** create/filter/remove opt-out; verify normalization, source, confirmation/undo, external DND explanation, quiet-hours timezone, and audit trail.
9. **Team:** invite each role, resend/cancel invite, change role, remove member, block last-owner removal, and verify profile role.
10. **Developer credentials:** create sandbox key, copy once, cancel, rotate, revoke with confirmation, and verify secret is never shown again.
11. **Webhook diagnostics:** configure endpoint, reject unsafe URL, reveal/copy secret safely, send test, inspect signature/delivery, retry, and disable/delete with confirmation.
12. **Logs:** apply URL-backed filters, reach filtered empty, open a request deep link, verify redaction and copyable correlation IDs, then restore filters on back navigation.
13. **Maker-checker:** maker proposes; same actor cannot approve; checker sees diff/rationale and approves/rejects; audit log records both actors and outcome.
14. **Impersonation:** require reason/duration, show persistent banner, restrict dangerous actions, stop immediately, and record the complete audit trail.
15. **Kill switch:** display effective state/blast radius, require confirmation and reason, verify failure posture, restore safely, and record audit events.
16. **Keyboard/accessibility:** traverse every control/dialog/table without pointer; visible focus never disappears; errors are announced and focus first invalid field; Escape closes overlays without data loss.

## Screenshot Index

All screenshots are full-page captures at the requested 1440x900 desktop viewport. They are stored under `docs/reviews/screenshots/live-ux-audit/`.

- Overview: [dashboard-home-desktop.png](./screenshots/live-ux-audit/dashboard-home-desktop.png)
- Transactions: [dashboard-flows-desktop.png](./screenshots/live-ux-audit/dashboard-flows-desktop.png)
- Send SMS overflow: [dashboard-send-desktop.png](./screenshots/live-ux-audit/dashboard-send-desktop.png)
- Campaign persistent loading state: [dashboard-campaigns-desktop.png](./screenshots/live-ux-audit/dashboard-campaigns-desktop.png)
- New Campaign: [dashboard-campaigns-new-desktop.png](./screenshots/live-ux-audit/dashboard-campaigns-new-desktop.png)
- Messages: [dashboard-messages-desktop.png](./screenshots/live-ux-audit/dashboard-messages-desktop.png)
- Number Verification: [dashboard-verify-desktop.png](./screenshots/live-ux-audit/dashboard-verify-desktop.png)
- Sender IDs: [dashboard-senders-desktop.png](./screenshots/live-ux-audit/dashboard-senders-desktop.png)
- Consent & DND: [dashboard-consent-desktop.png](./screenshots/live-ux-audit/dashboard-consent-desktop.png)
- Wallet & Billing overflow: [dashboard-wallet-desktop.png](./screenshots/live-ux-audit/dashboard-wallet-desktop.png)
- Team: [dashboard-team-desktop.png](./screenshots/live-ux-audit/dashboard-team-desktop.png)
- Profile: [dashboard-profile-desktop.png](./screenshots/live-ux-audit/dashboard-profile-desktop.png)
- Go Live: [dashboard-go-live-desktop.png](./screenshots/live-ux-audit/dashboard-go-live-desktop.png)
- Journeys off-canvas editor: [dashboard-journeys-desktop.png](./screenshots/live-ux-audit/dashboard-journeys-desktop.png)

No Developer Portal or Admin Console screenshots are indexed because neither application rendered a page. No narrow/mobile screenshot is presented as evidence because the responsive sweep was interrupted before it could be completed reliably.
