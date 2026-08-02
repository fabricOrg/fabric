-- Repair: a workspace already past go-live must not hold a LOCKED live environment.
--
-- `accounts.plan` and `environments.status` both encode "is this live", and only one transition
-- between them existed. The go_live proposal approval is the ONLY code that unlocks a live env, and
-- its companion plan update is guarded on `plan = 'sandbox'` — so a workspace provisioned directly
-- onto a paid plan (seeded, admin-provisioned, or self-serve) kept `live` at 'locked' forever. Such a
-- workspace sends live from the dashboard (any non-sandbox plan is live per virtual-phone.service.ts)
-- while `api-keys.service.ts` refuses every live key with `sandbox_no_live_keys`: live over the API was
-- unreachable, permanently, with no path to fix it from inside the product.
--
-- This does not weaken the compliance gate. A sandbox workspace is untouched, so go-live still gates
-- the sandbox -> paid transition; this only makes the environment agree with a plan that ALREADY
-- permits live delivery. `applications.service.ts` now creates the live env active for the same
-- reason, so new applications do not reintroduce the split.
--
-- Idempotent: re-running matches no rows once applied.
UPDATE "environments" e
SET "status" = 'active', "updated_at" = now()
FROM "accounts" a
WHERE a."id" = e."tenant_id"
  AND e."type" = 'live'
  AND e."status" = 'locked'
  AND a."plan" <> 'sandbox';
