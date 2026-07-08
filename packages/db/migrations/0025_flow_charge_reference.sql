-- Link a flow record to its Paystack collection intent (slice 2). The webhook that credits the
-- payment with this reference then completes the flow's charge + notify. Added as raw SQL (like the
-- RLS files) since flow_records is read/written via raw SQL in FlowsService, not the typed schema.
ALTER TABLE flow_records ADD COLUMN IF NOT EXISTS charge_reference text;
CREATE INDEX IF NOT EXISTS idx_flow_charge_reference ON flow_records (charge_reference);
