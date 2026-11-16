CREATE TYPE "public"."parcel_size" AS ENUM('S', 'M', 'L');--> statement-breakpoint
CREATE TABLE "product_materials" (
	"product_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	CONSTRAINT "product_materials_product_id_material_id_pk" PRIMARY KEY("product_id","material_id"),
	CONSTRAINT "product_materials_price_positive" CHECK ("product_materials"."price_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_publishable";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "parcel_size" "parcel_size";--> statement-breakpoint
-- Models that can already be printed get a medium parcel, so they stay publishable. Change it in the editor.
UPDATE "products" SET "parcel_size" = 'M' WHERE "print_base_price_cents" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "product_materials" ADD CONSTRAINT "product_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_materials" ADD CONSTRAINT "product_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_materials_material_id_idx" ON "product_materials" USING btree ("material_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_publishable" CHECK ("products"."status" <> 'published' OR (
                "products"."published_at" IS NOT NULL
                AND "products"."category_id" IS NOT NULL
                AND ("products"."digital_price_cents" IS NOT NULL OR "products"."print_base_price_cents" IS NOT NULL)
                AND ("products"."digital_price_cents" IS NULL OR "products"."license" IS NOT NULL)
                AND ("products"."print_base_price_cents" IS NULL OR "products"."parcel_size" IS NOT NULL)
            ));