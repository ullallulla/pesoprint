CREATE TABLE "download_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"file_id" uuid,
	"user_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "download_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_file_id_product_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."product_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "download_events_product_id_idx" ON "download_events" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "download_events_ip_hash_created_at_idx" ON "download_events" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "download_events_user_id_idx" ON "download_events" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_download_count_non_negative" CHECK ("products"."download_count" >= 0);