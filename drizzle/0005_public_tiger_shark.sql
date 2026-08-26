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
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payer_member_id_activity_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_receiver_member_id_activity_members_id_fk" FOREIGN KEY ("receiver_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_member_id_activity_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_deleted_by_member_id_activity_members_id_fk" FOREIGN KEY ("deleted_by_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlements_activity_occurred_idx" ON "settlements" USING btree ("activity_id","occurred_at");
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
