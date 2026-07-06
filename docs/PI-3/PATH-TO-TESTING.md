# Path to the first testing-environment push

_Status: 2026-07-05. Owner: fifi (PM/integrator). Companion to [PLAN.md](./PLAN.md) and
[../DEPLOYMENT-ENVIRONMENTS.md](../DEPLOYMENT-ENVIRONMENTS.md)._

## Where we are vs. the docs

PI-3's charter is **"make the thin thread real"** — one live, logged-in, real-send vertical slice,
deployed — not more mock screens. We have most of the thread real, but two hard bits stayed open
(top-up, and shipping the frontend), while recent effort went into PI-4/5 **mock-first breadth**.

| Capability | Doc intent | Built |
|---|---|---|
| Auth / session (WorkOS SSO) | PI-3 L1 | **REAL** |
| Wallet / ledger read (`GET /v1/wallet`) | PI-3 L2 | **REAL** — double-entry, exact bigint |
| Messages log + DLR reconcile | PI-3 L2 | **REAL** |
| SMS send (`POST /v1/sms/send`) | PI-3 L4 | **REAL engine, FakeProvider only** (no AT adapter) |
| Tenant onboarding (`/internal/admin/tenants`) | E19 | **REAL** — WorkOS org → account → invite |
| Plugin registry (`/internal/plugins`) | PI-5 | **REAL CRUD**, all real providers disabled/sandbox |
| Top-up (Paystack) | PI-3 L3 | **ABSENT** — `credit()` exists, no payment endpoint |
| Lighthouse saga (verify→charge→notify) | PI-5 E16 — the moat | **MOCK** — "we built the edges, not the seam" |
| Verify / campaigns / consent / senders / overview / journeys | PI-4/5 mock-first | **MOCK** (as intended) |
| Deploy | PI-3 L6 | testing env live (OIDC→ECR→ECS), **API-only image — frontends never deployed** |

**Two blockers to a first push:** the recent work is unmerged, and **the dashboard has never been
deployed** — only the API image ships.

## The first deployed slice (no redline crossed)

SSO login → Overview → **Wallet (real)** → **Send SMS (real engine, FakeProvider / sandbox)** →
**Messages (real)** → DLR reconcile. Everything still mock (journeys, campaigns, verify, consent,
senders, analytics charts) is hidden or clearly badged **"Preview / test-mode"** in the deployed
build (per [POSITIONING.md](../POSITIONING.md)'s honesty rule). Fake sends, no real money.

## Steps

0. **Land the pile (blocker).** Merge the current dashboard buildout into `dev` (squash, linear).
1. **Define the deployed slice.** Flag/hide mock surfaces so the testing build shows only the real
   thread + labelled previews. No live payments/SMS.
2. **Ship the dashboard image.** Standalone Next Dockerfile + a `deploy-dashboard` job mirroring the
   API's OIDC→ECR→ECS flow. This is the missing plumbing — the frontend reaching testing.
3. **Testing config/secrets.** WorkOS **staging** redirect URIs for the testing domain;
   `DASHBOARD_API_KEY`, `BFF_INTERNAL_TOKEN`, cookie password, DB — via **AWS Secrets Manager**
   (Infisical is local-only, not in the deploy path).
4. **Provision one testing tenant** through the real tenant-provisioning endpoint (staging WorkOS).
5. **Smoke + QA the thread** in testing: login → wallet → sandbox send → messages → DLR reconcile.
   Hand to adams for browser/integration QA.

## After the first push (gated / next, NOT this milestone)

- **Lighthouse saga on sandbox/fake** — `POST /v1/flows/verify-charge-notify` + the `transactions`
  read model. The seam/moat, still unbuilt; safe on FakeProvider + `sk_test_`. Highest product value.
- **Paystack top-up** and **Africa's Talking adapter** — real money / real SMS = **redlines**,
  human-gated flips only.

## Definition of done (this milestone)

Frontend + API both deployed to the testing env; a provisioned user can log in and complete the real
thread (wallet → sandbox send → messages → reconcile); mock surfaces are badged/hidden; standing
gates green; adams QA signed off. Staging/production remain disabled.
