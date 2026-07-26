CREATE TABLE "price_book_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"currency" text NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_price_book_rate" UNIQUE("price_book_id","channel","currency"),
	CONSTRAINT "price_book_rates_channel_chk" CHECK ("price_book_rates"."channel" in ('sms', 'email')),
	CONSTRAINT "price_book_rates_price_chk" CHECK ("price_book_rates"."unit_price_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_books_name_unique" UNIQUE("name"),
	CONSTRAINT "price_books_mode_chk" CHECK ("price_books"."mode" in ('subscription', 'token'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "price_book_id" uuid;--> statement-breakpoint
ALTER TABLE "price_book_rates" ADD CONSTRAINT "price_book_rates_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_default_price_book_per_mode" ON "price_books" USING btree ("mode") WHERE "price_books"."is_default";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE set null ON UPDATE no action;