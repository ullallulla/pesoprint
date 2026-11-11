CREATE TYPE "public"."license" AS ENUM('cc_by', 'cc_by_sa', 'cc_by_nc', 'cc_by_nc_sa', 'cc_by_nd', 'cc_by_nc_nd', 'cc0', 'gpl', 'lgpl', 'bsd', 'ocl', 'standard_digital', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."product_file_format" AS ENUM('stl', '3mf', 'step', 'obj', 'glb');--> statement-breakpoint
CREATE TYPE "public"."product_file_kind" AS ENUM('download', 'preview');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_slug_format" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "categories_not_own_parent" CHECK ("categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE TABLE "product_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "product_file_kind" NOT NULL,
	"format" "product_file_format" NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "product_files_preview_is_glb" CHECK ("product_files"."kind" <> 'preview' OR "product_files"."format" = 'glb'),
	CONSTRAINT "product_files_size_positive" CHECK ("product_files"."size_bytes" > 0),
	CONSTRAINT "product_files_sha256_format" CHECK ("product_files"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"alt" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "product_images_dimensions_positive" CHECK ("product_images"."width" > 0 AND "product_images"."height" > 0 AND "product_images"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"creator_id" text NOT NULL,
	"category_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"digital_price_cents" integer,
	"print_base_price_cents" integer,
	"license" "license",
	"size_x_mm" integer,
	"size_y_mm" integer,
	"size_z_mm" integer,
	"print_weight_g" integer,
	"featured_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')) STORED,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_slug_format" CHECK ("products"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "products_digital_price_non_negative" CHECK ("products"."digital_price_cents" >= 0),
	CONSTRAINT "products_print_price_positive" CHECK ("products"."print_base_price_cents" > 0),
	CONSTRAINT "products_paid_file_own_license" CHECK ("products"."digital_price_cents" = 0 OR "products"."license" IS NULL OR "products"."license" IN ('standard_digital', 'commercial')),
	CONSTRAINT "products_dimensions_positive" CHECK ("products"."size_x_mm" > 0 AND "products"."size_y_mm" > 0 AND "products"."size_z_mm" > 0 AND "products"."print_weight_g" > 0),
	CONSTRAINT "products_publishable" CHECK ("products"."status" <> 'published' OR (
                "products"."published_at" IS NOT NULL
                AND "products"."category_id" IS NOT NULL
                AND ("products"."digital_price_cents" IS NOT NULL OR "products"."print_base_price_cents" IS NOT NULL)
                AND ("products"."digital_price_cents" IS NULL OR "products"."license" IS NOT NULL)
            ))
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_files" ADD CONSTRAINT "product_files_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_files_one_preview_idx" ON "product_files" USING btree ("product_id") WHERE "product_files"."kind" = 'preview';--> statement-breakpoint
CREATE INDEX "product_files_product_id_position_idx" ON "product_files" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "product_images_product_id_position_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "products_status_published_at_idx" ON "products" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_creator_id_idx" ON "products" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "products_search_vector_idx" ON "products" USING gin ("search_vector");