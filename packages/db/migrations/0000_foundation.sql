CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."dek_status" AS ENUM('active', 'destroyed');--> statement-breakpoint
CREATE TYPE "public"."pii_kind" AS ENUM('phone', 'body', 'attribute');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_kind" AS ENUM('customer', 'reserved_clearing', 'revenue', 'gateway_clearing', 'writeoff');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_status" AS ENUM('active', 'frozen', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('topup', 'sms_reserve', 'sms_commit', 'sms_refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."ledger_txn_status" AS ENUM('pending', 'committed', 'refunded', 'reconciled');--> statement-breakpoint
CREATE TYPE "public"."ledger_txn_type" AS ENUM('topup', 'sms_charge', 'adjustment', 'refund');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"data_region" text DEFAULT 'af-south-1' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_membership_tenant_user" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_subject_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_external_subject_id_unique" UNIQUE("external_subject_id")
);
--> statement-breakpoint
CREATE TABLE "data_subjects" (
	"subject_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dek_keys" (
	"dek_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"wrapped_dek" "bytea",
	"status" "dek_status" DEFAULT 'active' NOT NULL,
	"destroyed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erasure_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"basis" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pii_vault" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" "pii_kind" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"dek_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "ledger_account_kind" NOT NULL,
	"currency" char(3) NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"status" "ledger_account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_ledger_account_tenant_currency_kind" UNIQUE("tenant_id","currency","kind")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"txn_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_amount_positive" CHECK ("ledger_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "ledger_txn_type" NOT NULL,
	"status" "ledger_txn_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_ledger_txn_idempotency" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "ledger_txn_idempotency_key_non_empty" CHECK (length("ledger_transactions"."idempotency_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subjects" ADD CONSTRAINT "data_subjects_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dek_keys" ADD CONSTRAINT "dek_keys_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dek_keys" ADD CONSTRAINT "dek_keys_subject_id_data_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."data_subjects"("subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_log" ADD CONSTRAINT "erasure_log_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_vault" ADD CONSTRAINT "pii_vault_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_vault" ADD CONSTRAINT "pii_vault_subject_id_data_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."data_subjects"("subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_vault" ADD CONSTRAINT "pii_vault_dek_id_dek_keys_dek_id_fk" FOREIGN KEY ("dek_id") REFERENCES "public"."dek_keys"("dek_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_txn_id_ledger_transactions_id_fk" FOREIGN KEY ("txn_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_account" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_txn" ON "ledger_entries" USING btree ("txn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ledger_txn_resolution_per_message" ON "ledger_transactions" USING btree ("tenant_id","reference_id") WHERE type = 'sms_charge' AND status IN ('committed', 'refunded');--> statement-breakpoint
CREATE INDEX "idx_ledger_txn_tenant_created" ON "ledger_transactions" USING btree ("tenant_id","created_at");