CREATE TABLE "exchange_rate_cache" (
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"rate" numeric NOT NULL,
	CONSTRAINT "exchange_rate_cache_base_currency_quote_currency_captured_at_provider_pk" PRIMARY KEY("base_currency","quote_currency","captured_at","provider")
);
