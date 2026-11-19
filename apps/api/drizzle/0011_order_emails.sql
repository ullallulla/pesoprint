CREATE TABLE "order_emails" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_id" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "order_emails_order_id_kind_unique" UNIQUE("order_id","kind"),
	CONSTRAINT "order_emails_kind_valid" CHECK ("order_emails"."kind" IN ('order_confirmation', 'order_shipped')),
	CONSTRAINT "order_emails_attempts_non_negative" CHECK ("order_emails"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_emails_unsent_idx" ON "order_emails" USING btree ("created_at") WHERE "order_emails"."sent_at" IS NULL;