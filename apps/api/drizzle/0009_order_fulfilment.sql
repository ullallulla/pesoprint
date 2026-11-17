ALTER TYPE "public"."order_status" ADD VALUE 'printing';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'delivered';--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_paid_has_paid_at";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "carrier" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "orders_queue_idx" ON "orders" USING btree ("status","paid_at") WHERE "orders"."parcel_size" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilment_has_parcel" CHECK ("orders"."status"::text NOT IN ('printing', 'shipped', 'delivered') OR "orders"."parcel_size" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipped_has_tracking" CHECK ("orders"."status"::text NOT IN ('shipped', 'delivered') OR ("orders"."carrier" IS NOT NULL AND "orders"."tracking_number" IS NOT NULL AND "orders"."shipped_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivered_has_delivered_at" CHECK ("orders"."status"::text <> 'delivered' OR "orders"."delivered_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_has_paid_at" CHECK ("orders"."status"::text IN ('pending', 'cancelled') OR "orders"."paid_at" IS NOT NULL);