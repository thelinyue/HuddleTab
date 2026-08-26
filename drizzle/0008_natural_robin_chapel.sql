ALTER TABLE "system_settings" ADD COLUMN "smtp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "smtp_secure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "smtp_username" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "smtp_password_encrypted" text;