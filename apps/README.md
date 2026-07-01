# apps/ — deployable Next.js surfaces

Reserved topology directory (PI-1 seam; **no app built until PI-2**). Each surface is its own
Next.js app **and** its own BFF (route handlers hold WorkOS tokens server-side; the browser only
gets an httpOnly sealed session cookie). All three import the shared `@app/fe-auth` session
mechanism and `@app/ui` design tokens.

**Two auth realms — separate apps, non-negotiable** (IDENTITY-SSO.md §13, F2.2; ratified
2026-07-01):

| App | Realm | Domain | Cookie | Status |
|---|---|---|---|---|
| `admin-console` | **staff** | `admin.*` (isolated ingress) | `wos-staff` | PI-2+ |
| `dev-portal` | customer | `developers.*` | `wos-session` | PI-2 |
| `dashboard` | customer | `sms.*` | `wos-session` | PI-2 (deferred) |

Staff and customer realms **cannot** share a Next app or a cookie — different session-validation
paths + blast-radius isolation. Per-realm `cookiePassword`, never shared.

See `team/frontend/PROPOSAL-fe-auth-bff-seam.md` for the full design.
