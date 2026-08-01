CREATE TABLE "offer_catalog_assignments" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"price_book_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_catalog_assignments" ADD CONSTRAINT "offer_catalog_assignments_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_catalog_assignments" ADD CONSTRAINT "offer_catalog_assignments_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_catalog_assignments" ADD CONSTRAINT "offer_catalog_assignments_assigned_by_staff_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_offer_catalog_assignments_book" ON "offer_catalog_assignments" USING btree ("price_book_id");