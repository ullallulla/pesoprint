CREATE TABLE "favourites" (
	"user_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourites_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "reviews_product_id_user_id_unique" UNIQUE("product_id","user_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_body_length" CHECK (char_length("reviews"."body") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rating_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favourites_user_id_created_at_idx" ON "favourites" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "favourites_product_id_idx" ON "favourites" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "reviews_product_id_created_at_idx" ON "reviews" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_user_id_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_rating_totals_valid" CHECK ("products"."rating_count" >= 0 AND "products"."rating_sum" BETWEEN "products"."rating_count" AND 5 * "products"."rating_count");--> statement-breakpoint
-- Keeps products.rating_sum and rating_count equal to the totals of the product's visible reviews. A trigger
-- rather than the reviews service, so they stay right however a review changes or goes: also when a deleted
-- account's reviews are cascaded away. It adds and subtracts instead of counting again, so concurrent reviews
-- of one model can't overwrite each other's totals (the row lock on the product orders them).
CREATE FUNCTION "reviews_update_rating_totals"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.hidden_at IS NULL THEN
		UPDATE "products"
		SET "rating_sum" = "rating_sum" - OLD.rating, "rating_count" = "rating_count" - 1
		WHERE "id" = OLD.product_id;
	END IF;
	IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.hidden_at IS NULL THEN
		UPDATE "products"
		SET "rating_sum" = "rating_sum" + NEW.rating, "rating_count" = "rating_count" + 1
		WHERE "id" = NEW.product_id;
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "reviews_rating_totals"
AFTER INSERT OR DELETE OR UPDATE OF "rating", "hidden_at", "product_id" ON "reviews"
FOR EACH ROW EXECUTE FUNCTION "reviews_update_rating_totals"();
