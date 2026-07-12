ALTER TABLE "messages"
  ADD CONSTRAINT "messages_delivery_mode_check"
  CHECK ("delivery_mode" IN ('virtual', 'live'));
