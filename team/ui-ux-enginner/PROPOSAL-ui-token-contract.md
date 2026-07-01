# PROPOSAL — `packages/ui` semantic token contract + theme layer

**Author:** ui-ux-engineers/edison · **Date:** 2026-07-01 · **Session:** app-arch-reassessment
**Lane:** frontend seam (edison) · **Bound to:** the converged frontend story (vivian + edison)
**Status:** PROPOSAL ONLY — nothing applied. No app built, no packages created, no deps installed.
This is the diff-equivalent artifact for @fifi's review; `packages/ui` is scaffolded only after ratification + lane-to-apply.

---

## 0. What this decides now (and why now)

PI-1 is API-only; no dashboard/console is built this PI. But **three Next.js surfaces are coming**
(admin-console, dev-portal, customer dashboard) and two things are *retrofit-expensive* once any
component exists:

1. **The semantic token contract** — the names + meaning of the design variables every component reads.
2. **The theme mechanism** — how we swap light / dark-operator / white-label without touching components.

Deciding these now costs a tiny CSS file + a `components.json`. Deciding them late = a rebuild + brand
drift across three apps. **This proposal fixes #1 and #2 and nothing else.** Component build stays PI-2.

---

## 1. Stack decision (needs @fifi / @vivian sign-off)

Current shadcn/ui convention (verified against shadcn docs, 2026-07):

- **Tailwind CSS v4** — `@import "tailwindcss"`, tokens exposed via `@theme inline`, **no `tailwind.config.js`**.
- **OKLCH** color space (Tailwind v4's native palette is OKLCH; wider gamut, perceptually uniform).
- `components.json`: `style: "new-york"`, `baseColor: "slate"`, `cssVariables: true`.
- First-class **`--sidebar-*`** token group — exactly what the operator navy chrome needs.

> **Consequence for our earlier wording:** in v4 there is no JS "Tailwind preset" to share. The shared
> artifact is a **single CSS theme file** (`packages/ui/src/theme.css`) that every app `@import`s. That
> *is* the preset. Cleaner than v3.

**Recommendation:** Tailwind v4 + shadcn new-york + OKLCH.
**Fallback (if the team pins v3):** identical token *names*, values as `H S% L%` triples, exposed via a
shared `tailwind-preset.ts` + `@layer base`. The **contract in §2 is version-agnostic** — only the file
format changes. Flagging the v4-vs-v3 pin as an open decision (§7).

---

## 2. The semantic token contract (the durable part)

Components **never** reference raw palette (no `indigo-600`, no hex). They read semantic tokens only.
This is the whole point: white-label + dark-operator become a var swap, not a component edit.

| Token | Role | Sourced from brief |
|---|---|---|
| `--background` / `--foreground` | app surface / text | `--soft2 #fafbfe` / `--ink #0f172a` |
| `--card` / `--card-foreground` | raised surface | `#fff` / `--ink` |
| `--popover` / `--popover-foreground` | overlays | `#fff` / `--ink` |
| `--primary` / `--primary-foreground` | brand action | `--brand #4f46e5` / white |
| `--secondary` / `--secondary-foreground` | secondary action | `--soft #f4f6fb` / `--ink` |
| `--muted` / `--muted-foreground` | subtle bg / secondary text | `--soft` / `--muted #64748b` |
| `--accent` / `--accent-foreground` | hover/active tint | `--soft` / `--brand-d #4338ca` |
| `--destructive` / `--destructive-foreground` | danger (delete, kill-switch) | `--red #dc2626` / white |
| `--success` / `--success-foreground` | delivered / positive | `--green #16a34a` / white |
| `--warning` / `--warning-foreground` | pending / caution | `--amber #b45309` / white |
| `--border` / `--input` | lines / field borders | `--line #e7eaf1` |
| `--ring` | focus ring (a11y) | brand-tinted `#818cf8` |
| `--radius` | base radius | `--r-s 10px` = `0.625rem` |

**Operator sidebar group** (the brief's navy chrome — a first-class shadcn token set):

| Token | From brief |
|---|---|
| `--sidebar` / `--sidebar-foreground` | `--sidebar #0d1124` / `--sidebar-ink #aeb6d4` |
| `--sidebar-primary` / `--sidebar-primary-foreground` | active `#818cf8` / white |
| `--sidebar-accent` / `--sidebar-accent-foreground` | `--sidebar-2 #151a35` / white |
| `--sidebar-border` / `--sidebar-ring` | `#151a35` / `#818cf8` |

**Domain semantic aliases** (map onto the base set — these keep product UI honest to the platform's
"radical transparency" brand; components read *these*, not raw color):

- `--status-delivered` → success · `--status-pending` → warning · `--status-failed` → destructive
- `--status-refunded` → accent (neutral-positive, distinct from delivered)
- `--money-credit` → success · `--money-debit` → foreground (debits are neutral, not alarming)
- `--audit-added` → success bg · `--audit-removed` → destructive bg  (for the before→after diff view)

> These domain aliases are the hook for newton's ledger model + the audit diff I flagged: a committed
> charge, a refund, and a manual adjustment each render from a *named* status token, so the transparency
> story is enforced in the token layer, not re-invented per screen.

---

## 3. Proposed files (contents = the diff; not yet written to `packages/`)

### `packages/ui/src/theme.css`  — the shared theme layer, imported by every app
```css
@import "tailwindcss";
@plugin "tailwindcss-animate";

/* dark = a class on <html>; white-label = a [data-brand] override layer (see §4) */
@custom-variant dark (&:is(.dark *));

/* ── LIGHT (default: customer surfaces) ───────────────────────────── */
:root {
  --radius: 0.625rem;                     /* brief --r-s (10px); cards may use calc(var(--radius)+4px) */

  --background: oklch(0.99 0.004 275);    /* #fafbfe */
  --foreground: oklch(0.208 0.042 265.8); /* slate-900 #0f172a */
  --card: oklch(1 0 0);
  --card-foreground: var(--foreground);
  --popover: oklch(1 0 0);
  --popover-foreground: var(--foreground);

  --primary: oklch(0.511 0.262 276.9);    /* indigo-600 #4f46e5 */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.968 0.007 248);    /* slate-100 / #f4f6fb */
  --secondary-foreground: var(--foreground);
  --muted: oklch(0.968 0.007 248);
  --muted-foreground: oklch(0.554 0.046 257.4);   /* slate-500 #64748b */
  --accent: oklch(0.968 0.007 248);
  --accent-foreground: oklch(0.457 0.24 277);      /* indigo-700 #4338ca */

  --destructive: oklch(0.577 0.245 27.3);          /* red-600 #dc2626 */
  --destructive-foreground: oklch(0.985 0 0);
  --success: oklch(0.627 0.194 149.2);             /* green-600 #16a34a */
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.555 0.163 49);                /* amber-700 #b45309 */
  --warning-foreground: oklch(0.985 0 0);

  --border: oklch(0.929 0.013 255.5);              /* #e7eaf1 */
  --input: var(--border);
  --ring: oklch(0.673 0.146 277);                  /* indigo-400 #818cf8 */

  /* operator sidebar (used by admin-console; harmless if unused elsewhere) */
  --sidebar: oklch(0.16 0.04 273);                 /* navy #0d1124 */
  --sidebar-foreground: oklch(0.76 0.04 276);      /* #aeb6d4 */
  --sidebar-primary: oklch(0.673 0.146 277);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.21 0.045 274);         /* #151a35 */
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(0.21 0.045 274);
  --sidebar-ring: oklch(0.673 0.146 277);

  /* domain aliases */
  --status-delivered: var(--success);
  --status-pending: var(--warning);
  --status-failed: var(--destructive);
  --status-refunded: var(--accent-foreground);
  --money-credit: var(--success);
  --money-debit: var(--foreground);
  --audit-added: var(--success);
  --audit-removed: var(--destructive);
}

/* ── DARK (operator default; optional customer toggle) ────────────── */
.dark {
  --background: oklch(0.145 0.02 270);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.185 0.02 270);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.185 0.02 270);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.673 0.146 277);      /* lift indigo for contrast on dark */
  --primary-foreground: oklch(0.145 0.02 270);
  --secondary: oklch(0.27 0.02 270);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.27 0.02 270);
  --muted-foreground: oklch(0.708 0.03 270);
  --accent: oklch(0.27 0.02 270);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.2);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.673 0.146 277);
  /* sidebar tokens already dark; success/warning inherit unless overridden */
}

/* ── Map tokens to Tailwind utilities (v4) ────────────────────────── */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 4px);   /* brief --r 14px = card radius */
}
```

> **OKLCH accuracy note:** values above are the Tailwind v4 palette equivalents of the brief's hex
> (slate / indigo / sky / emerald / amber / red ramps). At implementation, the base-ramp values should be
> **pinned from `tailwindcss`'s own OKLCH tokens** rather than hand-copied; the custom navy sidebar
> (`#0d1124`, `#151a35`) is converted directly from the brief. Exact digits are a rounding detail — the
> **contract (token names + roles) is the thing being ratified.**

### `packages/ui/components.json`
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/theme.css", "baseColor": "slate", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@app/ui/components", "utils": "@app/ui/lib/utils", "ui": "@app/ui/components/ui", "hooks": "@app/ui/hooks" },
  "iconLibrary": "lucide"
}
```

---

## 4. Theme strategy — light / dark-operator / white-label (the "decide now" mechanism)

Three theming needs, one mechanism (swap the CSS-var layer; components untouched):

1. **Light** — `:root`. Default for customer dashboard + dev-portal.
2. **Dark (operator)** — `.dark` on `<html>` in admin-console; the navy `--sidebar-*` chrome is always
   dark regardless (matches the brief's operator layout: dark rail + light content).
3. **White-label (reseller advantage H)** — a per-tenant override layer, **runtime-injectable** because
   tokens are just CSS vars. A tenant needs to change only the brand anchors:
   ```css
   [data-brand="acme"] {
     --primary: <tenant>; --primary-foreground: <tenant>;
     --ring: <tenant>; --sidebar-primary: <tenant>;
   }
   ```
   The BFF serves the tenant's brand values → app sets `data-brand` on `<html>` → done, no rebuild.
   **This is why the contract must land before components exist:** retrofitting runtime theming after
   hardcoded colors have leaked into components is the classic rewrite.

**Accessibility built in:** every fg/bg pair above targets WCAG AA; `--ring` is a visible focus ring on
all interactive elements (the brief already uses `outline:2px solid #818cf8`); shadcn/Radix primitives
give us keyboard + ARIA for free — decisive for the keyboard-driven, high-stakes operator console.

---

## 5. `packages/ui` topology + how the apps consume it

```
packages/ui/
├─ components.json          # shadcn config (workspace-aware)
├─ package.json             # name "@app/ui", exports "./theme.css", "./components/*", "./lib/*"
├─ src/
│  ├─ theme.css             # §3 — the ONE source of truth for tokens (PI-1 seam)
│  ├─ lib/utils.ts          # cn() helper
│  ├─ components/ui/        # shadcn primitives — EMPTY in PI-1; populated PI-2
│  └─ hooks/                # shared hooks — PI-2
└─ (no build step; ships source, apps compile via their own Tailwind)

apps/                        # created PI-2 (topology decision below)
├─ admin-console/  (adds .dark)   — control plane, admin.* realm
├─ dev-portal/                     — self-service, developers.* realm   (PI-2)
└─ dashboard/                      — customer business UI                (PI-2+)
```

Each app's root CSS is one line: `@import "@app/ui/theme.css";`. Adding a shadcn component runs the CLI
against `packages/ui` once; all apps get it.

**Topology decision (shared with @vivian, handed to @fifi):** `apps/*` for the three Next surfaces,
`packages/*` for shared code (`ui`, `contracts`, the FE-auth/BFF module). **Two auth realms → two+ apps,
never one app with a role flag** (aligns with F2.2 `admin.*` isolation + separate sealed cookies).

---

## 6. PI-1 seam vs PI-2 build (scope discipline)

| Item | PI-1 (this proposal, post-ratify) | PI-2 |
|---|---|---|
| `theme.css` token contract + `@theme inline` | ✅ scaffold (tiny) | — |
| `components.json` + `@app/ui` package shell + `cn()` | ✅ scaffold | — |
| shadcn primitives (button, table, dialog, form…) | ❌ | ✅ |
| `apps/*` Next surfaces | ❌ | ✅ |
| Safety primitives UI (step-up, maker-checker, impersonation banner, audit diff) | ❌ (spec only) | ✅ (joint w/ vivian's BFF session state) |

No app is built in PI-1. The seam is a CSS file + a package shell + a config — that's it.

---

## 7. Open decisions for @fifi / @vivian

1. **Tailwind v4 (OKLCH, no config — recommended) vs v3 (HSL + JS preset).** Contract is identical either
   way; only the file format changes. Recommend v4 for a greenfield FE.
2. **Package name / alias** — proposed `@app/ui` (matches `@app/domain`, `@app/contracts`). Confirm the scope.
3. **Does the PI-1 seam get scaffolded now, or is even the CSS file deferred to PI-2 kickoff?** My rec:
   scaffold the seam now (token contract + package shell, no components) so PI-2 starts against a fixed
   contract. It's a ~2-file change with zero runtime surface.
4. **White-label in scope for the token design now** (i.e. keep the `data-brand` anchor layer) even though
   the feature is P3? My rec: yes — designing the anchors costs nothing now and is the expensive retrofit.

---

## 8. Cross-lane bindings

- **@vivian (FE-auth/BFF):** white-label brand values (§4) are served by the BFF per tenant; the `data-brand`
  attribute is set from the session. The 5 safety flows = your session-state mechanism + my token-driven
  affordances (status/audit-diff tokens in §2).
- **@newton (ledger):** the manual-adjustment UI reads `--money-credit`/`--money-debit`/`--status-*` and
  renders the before→after via `--audit-added`/`--audit-removed`; maker picks reason-code + contra, UI
  previews the balanced legs. Token layer enforces the transparency brand.
- **@adams:** once primitives exist (PI-2), a11y assertions (focus-ring visible, AA contrast on token pairs,
  keyboard nav) become CI-gate candidates on `packages/ui`.

---

**Ask:** @fifi review the contract (§2) + stack call (§1) + the 4 decisions (§7). On ratification I'll
scaffold the seam (`theme.css` + package shell only) as a diff for your review — still no app build.
