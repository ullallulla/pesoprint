CREATE TYPE "public"."order_item_type" AS ENUM('digital');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TABLE "entitlements" (
	"user_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "order_item_type" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"title_snapshot" text NOT NULL,
	"license_snapshot" "license",
	CONSTRAINT "order_items_unit_price_non_negative" CHECK ("order_items"."unit_price_cents" >= 0),
	CONSTRAINT "order_items_digital_quantity_one" CHECK ("order_items"."type" <> 'digital' OR "order_items"."quantity" = 1)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_country" text NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"mollie_payment_id" text,
	"payment_status" text,
	"payment_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "orders_mollie_payment_id_unique" UNIQUE("mollie_payment_id"),
	CONSTRAINT "orders_currency_eur" CHECK ("orders"."currency" = 'EUR'),
	CONSTRAINT "orders_amounts_non_negative" CHECK ("orders"."subtotal_cents" >= 0 AND "orders"."tax_cents" >= 0),
	CONSTRAINT "orders_total_is_subtotal" CHECK ("orders"."total_cents" = "orders"."subtotal_cents"),
	CONSTRAINT "orders_tax_within_total" CHECK ("orders"."tax_cents" <= "orders"."total_cents"),
	CONSTRAINT "orders_vat_country_format" CHECK ("orders"."vat_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "orders_vat_rate_range" CHECK ("orders"."vat_rate_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "orders_paid_has_paid_at" CHECK ("orders"."status" NOT IN ('paid', 'refunded') OR "orders"."paid_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlements_product_id_idx" ON "entitlements" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_product_type_idx" ON "order_items" USING btree ("order_id","product_id","type");--> statement-breakpoint
CREATE INDEX "order_items_product_id_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_user_id_created_at_idx" ON "orders" USING btree ("user_id","created_at");