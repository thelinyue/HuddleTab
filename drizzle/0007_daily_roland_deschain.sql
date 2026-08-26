CREATE TABLE "expense_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expense_id" uuid NOT NULL,
	"client_attachment_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"safe_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_attachments_expense_client_uq" ON "expense_attachments" USING btree ("expense_id","client_attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_attachments_storage_key_uq" ON "expense_attachments" USING btree ("storage_key");