CREATE TABLE "colours" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"material_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hex" text NOT NULL,
	"in_stock" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "colours_hex_format" CHECK ("colours"."hex" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "colours" ADD CONSTRAINT "colours_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "colours_material_id_name_unique" ON "colours" USING btree ("material_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "materials_name_unique" ON "materials" USING btree (lower("name"));