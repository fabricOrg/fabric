CREATE TYPE "public"."gl_account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."gl_normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."gl_source_kind" AS ENUM('ledger_txn', 'manual_adjustment', 'reversal');--> statement-breakpoint
CREATE TABLE "gl_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "gl_account_type" NOT NULL,
	"normal_balance" "gl_normal_balance" NOT NULL,
	"control_for_kind" "ledger_account_kind",
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_gl_account_code" UNIQUE("code"),
	CONSTRAINT "gl_account_code_non_empty" CHECK (length("gl_accounts"."code") > 0)
);
--> statement-breakpoint
CREATE TABLE "gl_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tenant_id" uuid,
	"channel" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_journal_line_amount_positive" CHECK ("gl_journal_lines"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "gl_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_kind" "gl_source_kind" NOT NULL,
	"source_ref" text NOT NULL,
	"currency" char(3) NOT NULL,
	"line_count" integer NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"accounting_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverses_journal_id" uuid,
	"memo" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "uniq_gl_journal_idempotency" UNIQUE("idempotency_key"),
	CONSTRAINT "uniq_gl_journal_reverses" UNIQUE("reverses_journal_id"),
	CONSTRAINT "gl_journal_idempotency_key_non_empty" CHECK (length("gl_journals"."idempotency_key") > 0),
	CONSTRAINT "gl_journal_line_count_min" CHECK ("gl_journals"."line_count" >= 2),
	CONSTRAINT "gl_journal_no_self_reversal" CHECK ("gl_journals"."reverses_journal_id" <> "gl_journals"."id"),
	CONSTRAINT "gl_journal_reversal_shape" CHECK (("gl_journals"."source_kind" = 'reversal') = ("gl_journals"."reverses_journal_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "gl_journal_lines" ADD CONSTRAINT "gl_journal_lines_journal_id_gl_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."gl_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_journal_lines" ADD CONSTRAINT "gl_journal_lines_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_journals" ADD CONSTRAINT "gl_journals_reverses_journal_id_gl_journals_id_fk" FOREIGN KEY ("reverses_journal_id") REFERENCES "public"."gl_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_gl_account_control_for_kind" ON "gl_accounts" USING btree ("control_for_kind") WHERE control_for_kind IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_gl_journal_lines_journal" ON "gl_journal_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "idx_gl_journal_lines_account" ON "gl_journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_gl_journal_lines_tenant" ON "gl_journal_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_gl_journals_accounting_date" ON "gl_journals" USING btree ("accounting_date");--> statement-breakpoint
CREATE INDEX "idx_gl_journals_source" ON "gl_journals" USING btree ("source_kind","source_ref");