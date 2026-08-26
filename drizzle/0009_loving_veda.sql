CREATE TYPE "public"."backup_status" AS ENUM('READY', 'RESTORING', 'FAILED');--> statement-breakpoint
CREATE TABLE "backup_records" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "backup_status" DEFAULT 'READY' NOT NULL,
	"storage_path" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_records_created_at_idx" ON "backup_records" USING btree ("created_at");