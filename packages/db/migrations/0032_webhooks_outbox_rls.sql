-- ================================================================================================
-- WEBHOOKS + OUTBOX RLS — tenant isolation for webhook_endpoints (holds raw signing secrets:
-- RLS IS the read boundary) and outbox_events. Same model as every tenant table: non-owner
-- app_runtime, per-transaction `SET LOCAL app.tenant_id`, unset → 0 rows (fail-closed).
--
-- Provisioner (delivery worker's cross-tenant needs, mirroring 0027's least-privilege stance):
--   - outbox_events: SELECT (poller discovery: which tenants have undelivered events) +
--     UPDATE (mark delivered / bump attempts after the POST — the delivery outcome isn't a
--     tenant-scoped request, there is no session to run withTenant under a user; the worker
--     resolves the tenant FROM the row).
--   - webhook_endpoints: SELECT only (read url+secret to sign/deliver). Endpoint WRITES happen
--     exclusively through the tenant-scoped /v1/webhooks CRUD under app_runtime.
-- ================================================================================================

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_endpoints FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON outbox_events FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS provisioner_read ON webhook_endpoints;--> statement-breakpoint
CREATE POLICY provisioner_read ON webhook_endpoints FOR SELECT TO app_provisioner USING (true);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_read ON outbox_events;--> statement-breakpoint
CREATE POLICY provisioner_read ON outbox_events FOR SELECT TO app_provisioner USING (true);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_update ON outbox_events;--> statement-breakpoint
CREATE POLICY provisioner_update ON outbox_events FOR UPDATE TO app_provisioner USING (true) WITH CHECK (true);
