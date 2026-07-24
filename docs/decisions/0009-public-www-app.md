# ADR-0009 — Public-facing app: landing + docs (`apps/www`), playground as a separate track

- Status: **accepted** (owner sign-off 2026-07-23 — framework: **Astro + Starlight**; scope: landing +
  docs, playground a separate track)
- Date: 2026-07-23

## Problem

Fabric has three authenticated Next.js apps (dashboard, admin-console — dev-portal merged in per PI-6)
but **no public-facing surface**: no marketing landing and no developer documentation. PI-6 locked
"landing = a separate marketing app" but it was never built. Prospective developers have nowhere to
read the docs or see the brand before signing up.

Separately, the only playground is `examples/sdk-playground` — a vanilla Node server + vendored SDK
tarball, deployed ad-hoc as `fabric-playground-red`, with none of the product's design tokens. It
needs a better, React-based experience that shares the design tokens and supports the new SDK-007
managed-Email + channel features.

## Decision

**Two separate public surfaces, both consuming `@app/ui` for design-token consistency:**

### A. `apps/www` — landing + docs (this ADR's primary scope)

A fourth frontend app, deployed to Vercel, sharing `@app/ui`'s design tokens (`theme.css` + Tailwind v4)
so the public site and the product feel like one brand.

**Framework — DECIDED: Astro + Starlight (owner sign-off 2026-07-23).** Scoping finding: landing + docs
are SEO-critical, so the site must emit static HTML with content in the markup (SSG), not a JS-rendered
client shell. Astro Starlight is SSG/SEO-complete, MDX-native, minimal-JS, uses React islands for any
interactive bit, and carries the `@app/ui` tokens via Tailwind; self-hosted on Vercel. A pure client SPA (TanStack Router client-only / Vite+React) is therefore **not
recommended** for the docs half — its content is invisible to crawlers without a prerender step, and
docs discoverability is the platform's top organic-acquisition channel. "No server runtime" is still
satisfied — **SSG produces static files hosted on a CDN with no server**. True SSR (TanStack Start /
Next SSR) is only needed if we later add dynamic/personalized/auth'd content — deferred until a
concrete need. Candidates, to decide after the research:
- **Next.js static export / SSG** — reuses `@app/ui` + shadcn React components + Tailwind v4 directly
  (zero token porting), one framework the team already runs, static output to Vercel.
- **Astro (+ Starlight for docs)** — purpose-built for content/docs, best-in-class SEO + minimal JS,
  MDX-native, React islands for interactive bits, Tailwind works — but a new framework in the monorepo.
- (Client SPA kept only as a fallback if SEO is explicitly deprioritized — not advised for docs.)

- **Landing** — a static marketing page (hero, feature sections, pricing teaser, CTA → the dashboard
  `/signup`). No auth, no data plane.
- **Docs** — MDX-authored guides (quickstart, managed messaging, Email, webhooks, errors) plus an
  **API reference generated from the committed `openapi.json`** (single source; already produced by
  `@fabric-messaging/sdk`'s `openapi:generate`). MDX guides ship first; the generated reference is a
  later slice.
- **No playground.** The interactive playground is explicitly **out of `apps/www`** — it is a
  distinct app (track B). Docs may deep-link to it, but do not embed it.

### B. Playground — separate app (own track, not in this ADR's build slices)

The playground stays its own deployable app (evolving `examples/sdk-playground`, or a new
`apps/playground`), rebuilt in React + `@app/ui` tokens and extended to exercise the new features
(managed Email, `messages.preview/send` with the `channel` assertion). Tracked separately; the
security boundary below is a hard constraint wherever it lives.

**The load-bearing security boundary — a public playground is SANDBOX-ONLY, key server-held.**
A publicly reachable playground is a standing risk: a live key must never be selectable, entered, or
present in the browser bundle. (Precedent: the old playground shipped a *dead* live-write guard that
compared `environment === "production"` — a value the vocabulary no longer produces — so a live key
could have mutated through it. HANDOFF fixed it; the boundary must be structural.) Rules: the
playground calls the API through a **server-only route handler (BFF)** holding a **rotatable,
sandbox-only demo key** (`sk_test_…`); **no key is ever sent to the client**; the handler refuses a
non-sandbox key at startup (fail closed); per-IP rate limiting; live SMS/payments/Email stay redlined
(virtual/fake providers only).

## Competitor research (2026-07-23) — findings that shape the build

Teardown of Resend, Stripe, Twilio, Postmark, Loops, Bird, Sinch, Plivo, Africa's Talking, Termii,
Hubtel (landing + docs IA + framework signals). Highlights:

- **SSG is confirmed, unanimously.** Every best-in-class docs site serves pre-rendered HTML: Resend
  (**Mintlify**), Stripe (**Markdoc**, prebuilt), Twilio (Next SSG), Loops (**Astro**). Termii's
  JS-rendered SPA (a bot saw only `<title>`) is the anti-pattern — invisible to search. Docs win on
  organic search, so content must be in the initial HTML. **No SSR/server runtime.**
- **Docs framework in the wild:** Mintlify (Resend) and Astro Starlight (Loops) dominate modern dev
  docs; Docusaurus is the older default.
- **Landing patterns that convert (dev-first):** one-line "who+what" headline (Resend "Email for
  developers"); **code snippet in the hero with a language switcher** (Resend, Twilio); primary CTA
  "Start free" / secondary "Read the docs" (Postmark literally makes docs the secondary CTA);
  **publish pricing on the landing** (Plivo/Africa's Talking do — Bird/Sinch hide it and read as
  enterprise sales); a 2026 "agent/MCP onboarding" path + `llms.txt` (Resend, Bird, Loops).

**Docs IA to emulate** (Resend's quickstart shelf + Stripe's dual use-case/product axis):
Get started (intro · quickstart · sandbox & test keys · auth `sk_test_`/`sk_live_`) · Quickstarts
(Node, Next, curl, CLI cards) · Messaging (SMS · sender IDs & GH/NG registration · delivery reports ·
message definitions) · Email (send · domains & DNS SPF/DKIM/DMARC · templates · deliverability) ·
Webhooks (events · signature verification · retries & idempotency) · SDKs & tools (Node · CLI · MCP ·
OpenAPI · Postman) · Guides (OTP · transactional · broadcast · two-way) · API reference (three-pane,
language-tabbed) · Account (wallet & billing · rate limits · going live · compliance).
Quickstart shape: grab `sk_test_` → `curl`/Node send in sandbox (no funding, no sender-ID approval) →
see it in the dashboard log → "going live" checklist.

**"Do better" differentiators for a West-Africa CPaaS** (incumbents do these poorly):
1. Sender-ID & registration guidance (GH/NG) as a first-class quickstart step with per-country timelines.
2. The DND / transactional-vs-promotional route explained honestly + routed automatically.
3. Regional pricing in **GHS + NGN**, per-network, on the landing (not USD-only or hidden).
4. Zero-gate sandbox — send a real sandbox SMS/email before funding or sender-ID approval.
5. Honest deliverability + delivery-report semantics (DLR caveats, multipart billing, GSM-7/UCS-2).
6. One API shape across SMS + Email + message-definitions (one key, one webhook scheme, one idempotency model).
7. Wallet/billing transparency (balance, reservation, per-message cost) — we already have the double-entry wallet.
8. GH/NG compliance note (Ghana DPA, Nigeria NDPR).

**Framework recommendation (updated):** **Astro + Starlight** for the whole site (landing + docs) —
SSG/SEO-complete, MDX-native, minimal JS, React islands for any interactive bit, Tailwind for the
`@app/ui` tokens; self-hosted (own theme, unlike SaaS Mintlify) on Vercel. **Alternative:** Next.js
static export (reuses `@app/ui`/shadcn most directly, one framework — but weaker docs ergonomics than
Starlight). A client SPA (TanStack/Vite) is ruled out for the docs half by the SEO finding above.
Pending owner sign-off — introducing Astro adds a toolchain to the Next.js monorepo.

## Decomposition — `apps/www` (each slice independently shippable)

- **w-1 Scaffold.** `apps/www` Next.js App Router + `@app/ui` theme + shadcn + `/healthz` + Vercel
  config + a landing *shell* (hero + placeholder sections). Port :3400. Build + lint + typecheck green.
- **w-2 Landing.** Real marketing content (hero, features, CTA → dashboard signup). Responsive, a11y,
  light/dark. No data plane.
- **w-3 Docs framework.** MDX pipeline + nav/layout + first guides (quickstart, managed messaging,
  Email authoring, channel narrowing). Content-only, no secrets.
- **w-4 API reference.** Generated from `openapi.json`; wired into the docs nav.
- **w-5 Deploy + verify.** Vercel deploy (testing/public), smoke, verify no secret in the client bundle.

(Playground work — React rebuild + email/channel support + the sandbox-key BFF — is a separate track's
decomposition, not listed here.)

### Deploy

Vercel (like dashboard/playground), root-directory build, `/healthz` route, `HOSTNAME=0.0.0.0`.
**Not** AWS — the AWS OIDC→ECR→ECS pipeline is retired (see the deploy-docs follow-up). Public domain
wiring (custom domain, DNS) is an explicit later step, not part of the scaffold.

## Consequences

- A fourth frontend to build/deploy; `@app/ui` becomes a genuinely shared token source across www +
  the playground track + the product apps.
- Docs become a maintained artifact — guides track SDK changes; the generated API reference reduces
  drift for the reference half.
- The playground remains a separate deploy (`fabric-playground-red` today), improved on its own track;
  `apps/www` and the playground share only `@app/ui`, not code or a deploy.

## Redlines

- Public playground (its own track): **sandbox-only, key server-held, never in the client,
  rate-limited, fail closed.**
- No secret in any client bundle or in MDX/landing content.
- No live SMS/payments/Email; no production deploy without explicit human go.
