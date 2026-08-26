CREATE TYPE "public"."expense_category" AS ENUM('FOOD', 'TRANSPORT', 'LODGING', 'TICKET', 'SHOPPING', 'ENTERTAINMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."expense_split_mode" AS ENUM('EQUAL', 'EXACT', 'PERCENTAGE', 'WEIGHT');--> statement-breakpoint
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
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_activity_member_id_activity_members_id_fk" FOREIGN KEY ("activity_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_activity_member_id_activity_members_id_fk" FOREIGN KEY ("activity_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_member_id_activity_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deleted_by_member_id_activity_members_id_fk" FOREIGN KEY ("deleted_by_member_id") REFERENCES "public"."activity_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_creator_mutation_uq" ON "expenses" USING btree ("created_by_user_id","client_mutation_id");--> statement-breakpoint
CREATE INDEX "expenses_activity_occurred_idx" ON "expenses" USING btree ("activity_id","occurred_at");