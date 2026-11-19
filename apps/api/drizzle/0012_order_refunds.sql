ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_kind_valid";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_kind_valid" CHECK ("order_emails"."kind" IN ('order_confirmation', 'order_shipped', 'order_refunded'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_refunded_within_total" CHECK ("orders"."refunded_cents" BETWEEN 0 AND "orders"."total_cents");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_refunded_has_refund" CHECK ("orders"."status"::text <> 'refunded' OR ("orders"."refunded_at" IS NOT NULL AND "orders"."refunded_cents" = "orders"."total_cents"));