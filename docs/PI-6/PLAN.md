# PI-6 — Self-Service Developer Platform

Status: proposed 2026-07-12 (product owner). fifi to ratify sequencing before merge to `dev`.
Depends on: E13 (virtual-phone test mode + PII vault/DSR) landing in `dev` first — this PI branches
off the E13 tip and reworks its sandbox model per ADR-0004.

## Mission

Turn Fabric into a self-service developer platform for messaging (SMS now; Email + AI deferred),
comparable to Stripe / Twilio / Resend. A developer discovers the platform, signs up, gets a fully
provisioned sandbox, integrates an SDK, sends a first message, invites teammates, and requests
production — with minimal friction. Self-service is the **primary** path; ops-provisioning is an
**enterprise exception**.

## Direction decisions (2026-07-12)

- **Self-service primary; ops-provisioning = enterprise exception.** Relax the customer-realm
  invite-only deny for the self-serve case; staff realm stays invite-only/allowlist.
- **Data model = Workspace → Application → Environment** (ADR-0004; supersedes ADR-0002's flat
  sandbox-entitlement). RLS boundary stays the workspace/tenant.
- **dev-portal merges into the customer dashboard** as role-gated sections; `:3200` retired.
- **admin-console tenant-invite-as-primary removed**; slimmed enterprise manual-provision retained.
- **Landing = a separate marketing app.** **SDKs = Node + Python first.**
- **Email + AI assistant deferred** to their own later phases.

## Baseline: ~60-70% already exists

The repo is mid-flight on this trajectory (PI-4 verify-first + ADR-0002/0003). Already real: self-
serve auto-provision (gated `SELF_SERVE_SIGNUP_ENABLED` off), sandbox + virtual-phone sink, go-live
maker-checker (= production request), sender-ID review, API keys (real API), kill-switches, audit,
outbox+webhook delivery, privacy/DSR, team invite + roles. Gaps: landing surface, the App/Env
hierarchy, dev-portal real-wiring, SDKs, usage, templates (Email + AI are later).

## Cross-cutting workstreams

- **W-A — Flip self-serve on (gated).** `SELF_SERVE_SIGNUP_ENABLED=true` in **testing only**;
  staging/prod need explicit human go (redline). Converge the two provisioning paths onto one core.
- **W-B — Merge dev-portal → dashboard.** Developer surfaces become `developer_access`-gated
  dashboard sections; real-wire the mock keys/reference/webhooks/logs; one fewer ECS service +
  WorkOS redirect set.
- **W-C — IA redesign.** Progressive disclosure; never-empty pages; role gates.
- **W-D — admin-console realignment.** Remove invite-as-onboarding; keep enterprise manual-provision.

## Phases (see scratchpad SELF-SERVE-PIVOT-PLAN.md for the full build/wire table)

0. **Foundation (this branch first)** — ADR-0004 model: `applications` + `environments` tables,
   RLS, contracts, migration/backfill from the flat world, converge provisioning, re-key routing +
   go-live + E13 virtual-phone onto `environment.type`.
1. **Discovery & Signup** — marketing app, flip self-serve gated, auto-provision workspace→default
   app→sandbox env + test keys + webhook secret, welcome + personalized quickstart, first message.
   Metric: time-to-first-message < 5 min.
2. **Build** — merge dev-portal; real-wire keys/logs/webhooks per app-env; Node/Python SDKs; usage.
   (Templates later; Email + AI deferred.)
3. **Team** — invite/roles (exist) + workspace/application switching, org settings, customer-facing
   audit + billing surfaces.
4. **Production readiness** — go-live unlocks the live environment (ADR-0004); readiness checklist,
   provider/rate-limit surfaces, compliance status. (go-live flow already works.)
5. **Ops** — admin console (exists) + W-D demotion + fraud detection, provider health, usage
   monitoring, support tooling.

Later PIs: **Email** (net-new capability + adapter + provider) and **AI operational assistant**.

## Guardrails (unchanged)

- Redlines: self-serve gate ON in **testing only**; staging/prod human-gated. Live SMS (Arkesel
  real) + live payments (Paystack live) stay OFF. All outbound pinned to the owner's number
  server-side. No live external write or deploy-gate flip without explicit human confirmation.
- Staff realm stays invite-only/allowlist.
- Branch off the current shared ref; deliver; **fifi merges** (never advance `dev` directly). Local
  commits only until the program is complete; no push until done.
