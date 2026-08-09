ALTER TABLE "pricing_sell_rules" DROP CONSTRAINT IF EXISTS "pricing_sell_rules_channel_chk";
ALTER TABLE "pricing_sell_rules" DROP CONSTRAINT IF EXISTS "pricing_sell_rules_basis_chk";
ALTER TABLE "pricing_sell_rules" DROP CONSTRAINT IF EXISTS "pricing_sell_rules_class_chk";

ALTER TABLE "pricing_sell_rules" ADD CONSTRAINT "pricing_sell_rules_channel_chk"
  CHECK ("channel" in ('sms', 'email', 'whatsapp'));
ALTER TABLE "pricing_sell_rules" ADD CONSTRAINT "pricing_sell_rules_basis_chk"
  CHECK (("channel" = 'sms' and "unit_basis" = 'segment')
    or ("channel" = 'email' and "unit_basis" = 'recipient')
    or ("channel" = 'whatsapp' and "unit_basis" = 'message'));
ALTER TABLE "pricing_sell_rules" ADD CONSTRAINT "pricing_sell_rules_class_chk"
  CHECK ("traffic_class" is null or "traffic_class" in (
    'promotional',
    'transactional',
    'otp',
    'marketing',
    'utility',
    'authentication'
  ));

ALTER TABLE "provider_cost_rates" DROP CONSTRAINT IF EXISTS "provider_cost_rates_channel_chk";
ALTER TABLE "provider_cost_rates" DROP CONSTRAINT IF EXISTS "provider_cost_rates_basis_chk";
ALTER TABLE "provider_cost_rates" DROP CONSTRAINT IF EXISTS "provider_cost_rates_class_chk";

ALTER TABLE "provider_cost_rates" ADD CONSTRAINT "provider_cost_rates_channel_chk"
  CHECK ("channel" in ('sms', 'email', 'whatsapp'));
ALTER TABLE "provider_cost_rates" ADD CONSTRAINT "provider_cost_rates_basis_chk"
  CHECK (("channel" = 'sms' and "unit_basis" = 'segment')
    or ("channel" = 'email' and "unit_basis" = 'recipient')
    or ("channel" = 'whatsapp' and "unit_basis" = 'message'));
ALTER TABLE "provider_cost_rates" ADD CONSTRAINT "provider_cost_rates_class_chk"
  CHECK ("traffic_class" is null or "traffic_class" in (
    'promotional',
    'transactional',
    'otp',
    'marketing',
    'utility',
    'authentication'
  ));

ALTER TABLE "sandbox_usage_buckets" DROP CONSTRAINT IF EXISTS "sandbox_usage_buckets_channel_chk";
ALTER TABLE "sandbox_usage_buckets" ADD CONSTRAINT "sandbox_usage_buckets_channel_chk"
  CHECK ("channel" in ('sms', 'email', 'whatsapp'));

ALTER TABLE "sandbox_usage_events" DROP CONSTRAINT IF EXISTS "sandbox_usage_events_channel_chk";
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_channel_chk"
  CHECK ("channel" in ('sms', 'email', 'whatsapp'));
