# @app/ui — design-system foundation (token contract + theme layer)

**Status:** PI-1 **seam only** — token contract, theme layer, shadcn config, `cn()` util.
**No components, no `apps/*`** (component build is PI-2). Ratified in `app-arch-reassessment`
(2026-07-01); design rationale in `team/ui-ux-enginner/PROPOSAL-ui-token-contract.md`.

## What this package is
The single source of truth for design tokens across **all** frontends (admin-console, dev-portal,
customer dashboard). Components read **semantic tokens only** — never raw palette — so
light / dark-operator / white-label are a CSS-variable swap, not a component rewrite. That is the
whole reason this lands before any component exists.

## Stack
Tailwind **v4** + shadcn **new-york** + **OKLCH**. Tokens are exposed to utilities via `@theme inline`
in `src/theme.css` — there is **no `tailwind.config.js`**. Animations use `tw-animate-css` (the v4
replacement for `tailwindcss-animate`).

## How an app consumes it
```css
/* app's root stylesheet (e.g. apps/admin-console/app/globals.css) */
@import "@app/ui/theme.css";
```
```ts
import { cn } from "@app/ui/lib/utils";
```
Adding a shadcn component runs the CLI against **this** package once (`components.json`); every app
then gets it. Admin-console additionally sets `class="dark"` on `<html>` for the operator theme.

## Token groups (`src/theme.css`)
| Group | Tokens | Notes |
|---|---|---|
| Base surfaces | `--background/--foreground`, `--card*`, `--popover*` | mapped from brief palette |
| Actions | `--primary*`, `--secondary*`, `--accent*`, `--muted*` | indigo brand |
| Semantics | `--destructive*`, `--success*`, `--warning*` | delivery/money status source |
| Chrome | `--border`, `--input`, `--ring` | `--ring` = visible AA focus ring |
| Charts | `--chart-1..5` | categorical, brand-agnostic |
| Operator sidebar | `--sidebar*` | brief navy `#0d1124` chrome |
| **Domain aliases** | `--status-delivered/pending/failed/refunded`, `--money-credit/debit`, `--audit-added/removed` | enforce the transparency brand in the token layer |

## Themes
- **Light** — `:root` (customer surfaces, default).
- **Dark** — `.dark` on `<html>` (operator/admin-console).
- **White-label** — per-tenant `[data-brand]` override of the brand anchors, injected server-side by
  the BFF at session-validation (SSR `data-brand` on `<html>`, no flash). See the example block at the
  bottom of `theme.css`.

## Cross-lane integration points
- **fe-auth / BFF (vivian):** serves the tenant brand → sets `data-brand` on `<html>` server-side.
  `AppSession.stepUpAt` / `impersonation` back the safety-flow affordances (PI-2).
- **Ledger (newton):** the manual wallet-adjustment UI renders from `--money-credit/--money-debit`
  and the before→after audit diff from `--audit-added/--audit-removed`; maker picks reason-code +
  contra, UI previews the balanced legs.
- **QA (adams):** once primitives land (PI-2), a11y assertions (visible focus ring, AA contrast on
  token pairs, keyboard nav via Radix) become `@app/ui` CI-gate candidates.

## PI-1 vs PI-2
| | PI-1 (this seam) | PI-2 |
|---|---|---|
| `theme.css` token contract + `@theme inline` | ✅ | — |
| `components.json` + `package.json` + `cn()` | ✅ | — |
| shadcn primitives (button, table, dialog, form…) | ❌ | ✅ |
| `apps/*` Next surfaces | ❌ | ✅ |
| Safety-flow UI (step-up, maker-checker, impersonation banner, audit diff) | spec only | ✅ |

## Verification note
`biome check` passes on the TS/JSON files (CSS needs `css.parser.tailwindDirectives` in root
`biome.jsonc` — see the frontend-CSS lint note). `cn()` deps (`clsx` + `tailwind-merge`) install now so
`tsc` is green; `tailwindcss` v4 + `tw-animate-css` are **peer deps** (consumed by apps at PI-2, not the
seam) — declared-not-installed, mirroring the fe-auth seam's discipline.
