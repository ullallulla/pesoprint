ALTER TABLE "orders" DROP CONSTRAINT "orders_total_is_subtotal";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_non_negative";--> statement-breakpoint
DROP INDEX "order_items_order_product_type_idx";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "print_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "parcel_size" "parcel_size";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_address" jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_product_digital_idx" ON "order_items" USING btree ("order_id","product_id") WHERE "order_items"."type" = 'digital';--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_print_has_choice" CHECK ("order_items"."type"::text <> 'print' OR ("order_items"."material_id" IS NOT NULL AND "order_items"."print_snapshot" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_is_subtotal_plus_shipping" CHECK ("orders"."total_cents" = "orders"."subtotal_cents" + "orders"."shipping_cents");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_has_parcel" CHECK ("orders"."parcel_size" IS NOT NULL OR "orders"."shipping_cents" = 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_non_negative" CHECK ("orders"."subtotal_cents" >= 0 AND "orders"."shipping_cents" >= 0 AND "orders"."tax_cents" >= 0);