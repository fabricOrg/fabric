-- Published message-definition versions are immutable evidence. Migration 0076 intended to narrow
-- both application roles to SELECT + INSERT, but the live-derived Neon branch still held UPDATE and
-- DELETE for app_runtime. Reassert the steady-state privilege explicitly and let the standing
-- security check detect any future drift.
REVOKE UPDATE, DELETE, TRUNCATE
  ON message_definition_versions
  FROM app_runtime, app_provisioner;--> statement-breakpoint

GRANT SELECT, INSERT
  ON message_definition_versions
  TO app_runtime, app_provisioner;
