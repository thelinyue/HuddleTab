CREATE TYPE "public"."activity_role" AS ENUM('OWNER', 'ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('ACTIVE', 'ENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."invite_mode" AS ENUM('DIRECT_JOIN', 'REQUIRE_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'LEFT');--> statement-breakpoint
CREATE TYPE "public"."member_type" AS ENUM('USER', 'GUEST');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('FOOD', 'TRANSPORT', 'LODGING', 'TICKET', 'SHOPPING', 'ENTERTAINMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."expense_split_mode" AS ENUM('EQUAL', 'EXACT', 'PERCENTAGE', 'WEIGHT');--> statement-breakpoint
CREATE TYPE "public"."email_kind" AS ENUM('SYNTHETIC', 'REAL');--> statement-breakpoint
CREATE TYPE "public"."registration_policy" AS ENUM('INVITE_ONLY', 'OPEN');--> statement-breakpoint
CREATE TYPE "public"."system_role" AS ENUM('system_admin');--> statement-breakpoint
CREATE TYPE "public"."theme_preference" AS ENUM('SYSTEM', 'LIGHT', 'DARK');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"base_currency" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "activity_status" DEFAULT 'ACTIVE' NOT NULL,
	"owner_member_id" text NOT NULL,
	"invite_mode" "invite_mode" DEFAULT 'DIRECT_JOIN' NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "activity_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"actor_user_id" text,
	"actor_member_id" text,
	"event_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_invite_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_invite_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "activity_join_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by_member_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_members" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"member_type" "member_type" NOT NULL,
	"role" "activity_role" NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "activity_user_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"sender_member_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_activity_preferences" (
	"user_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"last_category" text,
	"recent_participant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recent_payer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recent_currency" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"issuer" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" text,
	"display_username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_cache" (
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"rate" numeric NOT NULL,
	CONSTRAINT "exchange_rate_cache_base_currency_quote_currency_captured_at_provider_pk" PRIMARY KEY("base_currency","quote_currency","captured_at","provider")
);
--> statement-breakpoint
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
CREATE TABLE "expense_payments" (
	"expense_id" uuid NOT NULL,
	"activity_member_id" text NOT NULL,
	"original_amount_minor" bigint NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	CONSTRAINT "expense_payments_expense_id_activity_member_id_pk" PRIMARY KEY("expense_id","activity_member_id"),
	CONSTRAINT "expense_payment_original_positive" CHECK ("expense_payments"."original_amount_minor" > 0),
	CONSTRAINT "expense_payment_base_nonnegative" CHECK ("expense_payments"."base_amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expense_shares" (
	"expense_id" uuid NOT NULL,
	"activity_member_id" text NOT NULL,
	"split_input_minor" bigint,
	"original_amount_minor" bigint NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	CONSTRAINT "expense_shares_expense_id_activity_member_id_pk" PRIMARY KEY("expense_id","activity_member_id"),
	CONSTRAINT "expense_share_original_nonnegative" CHECK ("expense_shares"."original_amount_minor" >= 0),
	CONSTRAINT "expense_share_base_nonnegative" CHECK ("expense_shares"."base_amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"title" text NOT NULL,
	"category" "expense_category" NOT NULL,
	"original_currency" text NOT NULL,
	"original_amount_minor" bigint NOT NULL,
	"base_currency" text NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	"exchange_rate" numeric NOT NULL,
	"exchange_rate_source" text NOT NULL,
	"exchange_rate_at" timestamp with time zone NOT NULL,
	"split_mode" "expense_split_mode" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by_member_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"client_mutation_id" text NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_member_id" text,
	CONSTRAINT "expenses_original_positive" CHECK ("expenses"."original_amount_minor" > 0),
	CONSTRAINT "expenses_base_positive" CHECK ("expenses"."base_amount_minor" > 0),
	CONSTRAINT "expenses_version_positive" CHECK ("expenses"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"payer_member_id" text NOT NULL,
	"receiver_member_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by_member_id" text NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_member_id" text,
	CONSTRAINT "settlements_amount_positive" CHECK ("settlements"."amount_minor" > 0),
	CONSTRAINT "settlements_distinct_members" CHECK ("settlements"."payer_member_id" <> "settlements"."receiver_member_id"),
	CONSTRAINT "settlements_version_positive" CHECK ("settlements"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "security_rate_limit_buckets" (
	"bucket_key" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "security_rate_limit_buckets_bucket_key_window_started_at_pk" PRIMARY KEY("bucket_key","window_started_at")
);
--> statement-breakpoint
CREATE TABLE "system_bootstrap" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_roles" (
	"user_id" text NOT NULL,
	"role" "system_role" NOT NULL,
	"granted_by_user_id" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"registration_policy" "registration_policy" DEFAULT 'INVITE_ONLY' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username_normalized" text NOT NULL,
	"nickname" text NOT NULL,
	"email_kind" "email_kind" NOT NULL,
	"avatar_preset" integer,
	"disabled_at" timestamp with time zone,
	"theme_preference" "theme_preference" DEFAULT 'SYSTEM' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_avatar_preset_check" CHECK ("user_profiles"."avatar_preset" between 1 and 6)
);
--> statement-breakpoint
ALTER TABLE "activity_audit_logs" ADD CONSTRAINT "activity_audit_logs_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_audit_logs" ADD CONSTRAINT "activity_audit_logs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_invite_tokens" ADD CONSTRAINT "activity_invite_tokens_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_join_requests" ADD CONSTRAINT "activity_join_requests_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_join_requests" ADD CONSTRAINT "activity_join_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_members" ADD CONSTRAINT "activity_members_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_members" ADD CONSTRAINT "activity_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_user_invitations" ADD CONSTRAINT "activity_user_invitations_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_user_invitations" ADD CONSTRAINT "activity_user_invitations_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_preferences" ADD CONSTRAINT "user_activity_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_preferences" ADD CONSTRAINT "user_activity_preferences_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_activity_member_id_activity_members_id_fk" FOREIGN KEY ("activity_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_activity_member_id_activity_members_id_fk" FOREIGN KEY ("activity_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_member_id_activity_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deleted_by_member_id_activity_members_id_fk" FOREIGN KEY ("deleted_by_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payer_member_id_activity_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_receiver_member_id_activity_members_id_fk" FOREIGN KEY ("receiver_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_member_id_activity_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_deleted_by_member_id_activity_members_id_fk" FOREIGN KEY ("deleted_by_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_roles" ADD CONSTRAINT "system_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_roles" ADD CONSTRAINT "system_roles_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_members_user_uq" ON "activity_members" USING btree ("activity_id","user_id");--> statement-breakpoint
CREATE INDEX "activity_members_activity_idx" ON "activity_members" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_activity_preferences_uq" ON "user_activity_preferences" USING btree ("user_id","activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_uq" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_attachments_expense_client_uq" ON "expense_attachments" USING btree ("expense_id","client_attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_attachments_storage_key_uq" ON "expense_attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_creator_mutation_uq" ON "expenses" USING btree ("created_by_user_id","client_mutation_id");--> statement-breakpoint
CREATE INDEX "expenses_activity_occurred_idx" ON "expenses" USING btree ("activity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "settlements_activity_occurred_idx" ON "settlements" USING btree ("activity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "rate_limit_expiry_idx" ON "security_rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_username_uq" ON "user_profiles" USING btree ("username_normalized");
--> statement-breakpoint
ALTER TABLE "activity_members" ADD CONSTRAINT "activity_members_type_ck"
  CHECK ((member_type = 'USER' AND user_id IS NOT NULL) OR (member_type = 'GUEST' AND user_id IS NULL));
--> statement-breakpoint
ALTER TABLE "activity_members" ADD CONSTRAINT "activity_members_id_activity_uq" UNIQUE("id", "activity_id");
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_same_activity_fk"
  FOREIGN KEY ("owner_member_id", "id") REFERENCES "activity_members"("id", "activity_id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE UNIQUE INDEX "activity_members_one_owner_uq" ON "activity_members" USING btree ("activity_id") WHERE "activity_members"."role" = 'OWNER';
--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payer_same_activity_fk"
  FOREIGN KEY ("payer_member_id", "activity_id") REFERENCES "activity_members"("id", "activity_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_receiver_same_activity_fk"
  FOREIGN KEY ("receiver_member_id", "activity_id") REFERENCES "activity_members"("id", "activity_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_creator_same_activity_fk"
  FOREIGN KEY ("created_by_member_id", "activity_id") REFERENCES "activity_members"("id", "activity_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_deleted_by_same_activity_fk"
  FOREIGN KEY ("deleted_by_member_id", "activity_id") REFERENCES "activity_members"("id", "activity_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
INSERT INTO "system_settings" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "system_bootstrap" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;
