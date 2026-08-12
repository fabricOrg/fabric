# Temporary: CI as the cron trigger

**Status: TEMPORARY. Delete before production.** Tracked here so it is removed deliberately rather
than discovered years later by someone wondering why CI pokes the API every hour.

## What it is

`.github/workflows/whatsapp-template-sync.yml` calls
`POST /internal/admin/whatsapp/template-sync` on the testing API every hour.

## Why it exists

The API already schedules that work itself — `WhatsappTemplateSyncScheduler` runs `@Cron(EVERY_HOUR)`
and `render.yaml` sets `RUNTIME_ROLE=all`, so the scheduler is enabled. It still never fires, because
Render's free tier sleeps the service after ~15 minutes idle and a sleeping process runs no cron.

The symptom was not subtle: testing held **zero** WhatsApp templates, and the compose picker told
customers to go and create templates in a Meta Business Manager that belongs to us, not them.

The workflow's HTTP request wakes the instance, and the sync then runs in the woken process. The
wake-up is the mechanism, not an obstacle — which is why `--max-time` is 180s.

## What it does NOT fix

- **The queue worker.** A worker needs a process alive when a job arrives; nothing external can poke
  that into existence. This is why the Redis queue path has never been genuinely exercised in
  testing.
- **Any other scheduled job.** Only work with an HTTP trigger can be driven this way. Today that is
  the template sync alone.
- **Timeliness.** GitHub delays scheduled runs under load, and disables schedules entirely after 60
  days of repository inactivity. Fine for refreshing a cache; not fine for anything with a deadline.

## Required configuration — in the `testing` ENVIRONMENT, not at repository level

This repo holds **zero** repository-level secrets; every one lives in a GitHub Environment
(`testing`, `staging`, `production`, plus per-app ones). A workflow only sees them if its job declares
`environment: testing`, which this one does. Setting them at repository level instead looks correct in
the UI and arrives as empty strings at runtime.


| Kind | Name | Where the value comes from |
| --- | --- | --- |
| Variable | `TESTING_API_BASE_URL` (already set) | The Render service URL, currently `https://fabric-jezz.onrender.com`. Not a secret. |
| Secret | `BFF_INTERNAL_TOKEN` (already set — the deploy workflow uses it too) | **The Render dashboard**, `fabric-api` -> Environment. NOT the Infisical `dev` value — `render.yaml` marks it `sync: false`, so the deployed value was set in the dashboard and the dev one is local-only. Verified: the dev token gets a 401 from the deployed API. |
| — | `EDGE_SHARED_SECRET` | **Not needed, and not sent.** `edgeOriginAllowed` returns true when the secret is unset, and it is set neither in `render.yaml` nor Infisical. Confirmed empirically: an unauthenticated call to `/internal/admin/tenants` returns 401 from the BFF guard, not 403 from the edge guard, so the request reached Nest. If the API ever gets one, add the secret to the `testing` environment AND re-add the `x-fabric-edge-secret` header here. |

Rotating `BFF_INTERNAL_TOKEN` on Render means rotating it here too, or the workflow fails with 401 and
the cache silently stops refreshing — a failure mode with no customer-visible symptom until a template
goes stale.

## Delete it when

**The API runs on hosting that does not sleep.** At that point the existing `@Cron` fires on its own
and this workflow is pure noise — worse, it is a second trigger nobody remembers, doubling the Meta
fan-out on every tick.

Removal is three steps:

1. Delete `.github/workflows/whatsapp-template-sync.yml`.
2. Delete this file.
3. Remove `TESTING_API_BASE_URL`, and the two secret copies if nothing else uses them.

The admin route itself (`POST /internal/admin/whatsapp/template-sync`) **stays**. It is not part of
this workaround — "refresh the catalog now" is something an operator needs whether or not the cron is
healthy. Only the scheduled caller is temporary.

## What was evaluated instead

Northflank's free sandbox advertises two always-on services and would have fixed both this and the
queue worker. It was blocked on two things at the time of writing: creating any service requires a
default payment method on the account (HTTP 409), and the smallest plan is 0.1 vCPU / 256 MB against
the 512 MB the API currently runs in. The next size up is ~$5.40/month, at which point it is a paid
migration and should be compared against simply paying Render not to sleep.
