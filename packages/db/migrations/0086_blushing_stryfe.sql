ALTER TYPE "public"."ledger_reason" ADD VALUE IF NOT EXISTS 'message_reserve' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_reason" ADD VALUE IF NOT EXISTS 'message_commit' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_reason" ADD VALUE IF NOT EXISTS 'message_refund' BEFORE 'adjustment';