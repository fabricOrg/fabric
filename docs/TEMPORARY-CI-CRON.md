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

## Required configuration — ORGANISATION secrets

Both live at organisation level (`fabricOrg` -> Settings -> Secrets and variables -> Actions), with
`all` repository visibility:

| Kind | Name | Notes |
| --- | --- | --- |
| Org secret | `TESTING_API_BASE_URL` | The Render service URL. A secret rather than a variable, so it is masked in logs — harmless for a URL, but it means the workflow must read `secrets.`, not `vars.` |
| Org secret | `BFF_INTERNAL_TOKEN` | Must be the value the DEPLOYED api uses. `render.yaml` marks it `sync: false`, so it was set in the Render dashboard; the Infisical `dev` value is local-only and gets a 401 from the deployed API. |
| — | `EDGE_SHARED_SECRET` | Not needed, and not sent. `edgeOriginAllowed` returns true when unset, and it is defined nowhere. Confirmed empirically: an unauthenticated call to `/internal/admin/tenants` returns 401 from the BFF guard, not 403 from the edge guard. If the API ever gets one, add it AND re-add the `x-fabric-edge-secret` header. |

### Why not the `testing` environment

Two constraints that cannot both be met. The `testing` environment carries a custom branch policy
allowing only the `testing` branch, while GitHub runs scheduled workflows **only from the default
branch** (`dev`) — so `environment: testing` fails the job before any step runs. Widening that policy
to `dev` was rejected deliberately: the environment holds the AWS role ARN and the Render and Vercel
deploy tokens, and a throwaway cache-refresh workflow has no business near them.

Rotating `BFF_INTERNAL_TOKEN` on Render means rotating the org secret too, or the workflow fails with
401 and the cache silently stops refreshing — a failure with no customer-visible symptom until a
template goes stale.

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
