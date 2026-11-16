ALTER TYPE "public"."order_item_type" ADD VALUE 'print';--> statement-breakpoint
CREATE TABLE "material_colours" (
	"material_id" uuid NOT NULL,
	"colour_id" uuid NOT NULL,
	"in_stock" boolean DEFAULT true NOT NULL,
	CONSTRAINT "material_colours_material_id_colour_id_pk" PRIMARY KEY("material_id","colour_id")
);
--> statement-breakpoint
CREATE TABLE "product_colour_option_colours" (
	"option_id" uuid NOT NULL,
	"colour_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "product_colour_option_colours_option_id_position_pk" PRIMARY KEY("option_id","position"),
	CONSTRAINT "product_colour_option_colours_option_id_colour_id_unique" UNIQUE("option_id","colour_id")
);
--> statement-breakpoint
CREATE TABLE "product_colour_options" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "colours" DROP CONSTRAINT "colours_material_id_materials_id_fk";
--> statement-breakpoint
DROP INDEX "colours_material_id_name_unique";--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "multicolour" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "material_colours" ADD CONSTRAINT "material_colours_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_colours" ADD CONSTRAINT "material_colours_colour_id_colours_id_fk" FOREIGN KEY ("colour_id") REFERENCES "public"."colours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_colour_option_colours" ADD CONSTRAINT "product_colour_option_colours_option_id_product_colour_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_colour_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_colour_option_colours" ADD CONSTRAINT "product_colour_option_colours_colour_id_colours_id_fk" FOREIGN KEY ("colour_id") REFERENCES "public"."colours"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_colour_options" ADD CONSTRAINT "product_colour_options_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_colours_colour_id_idx" ON "material_colours" USING btree ("colour_id");--> statement-breakpoint
CREATE INDEX "product_colour_option_colours_colour_id_idx" ON "product_colour_option_colours" USING btree ("colour_id");--> statement-breakpoint
CREATE INDEX "product_colour_options_product_id_idx" ON "product_colour_options" USING btree ("product_id");--> statement-breakpoint
-- Colours stop belonging to a material: a colour used by several materials ("Black" in PLA and PETG) becomes
-- one colour, the oldest. Each material keeps the colours it had, with their stock, in "material_colours".
INSERT INTO "material_colours" ("material_id", "colour_id", "in_stock")
	SELECT "colour"."material_id", "kept"."id", "colour"."in_stock"
	FROM "colours" AS "colour"
	CROSS JOIN LATERAL (
		SELECT "same"."id" FROM "colours" AS "same"
		WHERE lower("same"."name") = lower("colour"."name")
		ORDER BY "same"."id" LIMIT 1
	) AS "kept";--> statement-breakpoint
DELETE FROM "colours" AS "newer" USING "colours" AS "older"
	WHERE lower("newer"."name") = lower("older"."name") AND "newer"."id" > "older"."id";--> statement-breakpoint
CREATE UNIQUE INDEX "colours_name_unique" ON "colours" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "colours" DROP COLUMN "material_id";--> statement-breakpoint
ALTER TABLE "colours" DROP COLUMN "in_stock";