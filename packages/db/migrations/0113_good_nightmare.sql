CREATE TYPE "public"."gl_posting_status" AS ENUM('pending', 'posted', 'failed');--> statement-breakpoint
CREATE TABLE "gl_posting_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ledger_txn_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"channel" text,
	"legs" jsonb NOT NULL,
	"status" "gl_posting_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"posted_journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_gl_posting_request_txn" UNIQUE("ledger_txn_id"),
	CONSTRAINT "gl_posting_request_legs_min" CHECK (jsonb_typeof("gl_posting_requests"."legs") = 'array' AND jsonb_array_length("gl_posting_requests"."legs") >= 2),
	CONSTRAINT "gl_posting_request_attempts_non_negative" CHECK ("gl_posting_requests"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gl_posting_requests" ADD CONSTRAINT "gl_posting_requests_ledger_txn_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_txn_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gl_posting_requests_pending" ON "gl_posting_requests" USING btree ("created_at") WHERE status = 'pending';