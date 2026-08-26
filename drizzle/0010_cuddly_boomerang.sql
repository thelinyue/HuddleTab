CREATE TABLE "maintenance_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
