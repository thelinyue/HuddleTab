CREATE TYPE "public"."activity_role" AS ENUM('OWNER', 'ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('ACTIVE', 'ENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."invite_mode" AS ENUM('DIRECT_JOIN', 'REQUIRE_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'LEFT');--> statement-breakpoint
CREATE TYPE "public"."member_type" AS ENUM('USER', 'GUEST');--> statement-breakpoint
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
ALTER TABLE "activity_audit_logs" ADD CONSTRAINT "activity_audit_logs_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_audit_logs" ADD CONSTRAINT "activity_audit_logs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_invite_tokens" ADD CONSTRAINT "activity_invite_tokens_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_join_requests" ADD CONSTRAINT "activity_join_requests_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_join_requests" ADD CONSTRAINT "activity_join_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_members" ADD CONSTRAINT "activity_members_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_members" ADD CONSTRAINT "activity_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_user_invitations" ADD CONSTRAINT "activity_user_invitations_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_user_invitations" ADD CONSTRAINT "activity_user_invitations_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_preferences" ADD CONSTRAINT "user_activity_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_preferences" ADD CONSTRAINT "user_activity_preferences_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_members_activity_user_uq" ON "activity_members" USING btree ("activity_id","user_id");--> statement-breakpoint
CREATE INDEX "activity_members_activity_idx" ON "activity_members" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_invite_tokens_one_enabled_uq" ON "activity_invite_tokens" USING btree ("activity_id") WHERE "activity_invite_tokens"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "activity_join_requests_pending_uq" ON "activity_join_requests" USING btree ("activity_id","user_id") WHERE "activity_join_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "user_activity_preferences_user_activity_uq" ON "user_activity_preferences" USING btree ("user_id","activity_id");--> statement-breakpoint
alter table activity_members add constraint activity_members_type_ck
  check ((member_type='USER' and user_id is not null) or (member_type='GUEST' and user_id is null));--> statement-breakpoint
alter table activity_members add constraint activity_members_id_activity_uq unique (id, activity_id);--> statement-breakpoint
alter table activities add constraint activities_owner_same_activity_fk
  foreign key (owner_member_id, id) references activity_members(id, activity_id)
  deferrable initially deferred;--> statement-breakpoint
create unique index activity_members_one_owner_uq on activity_members(activity_id) where role='OWNER';
