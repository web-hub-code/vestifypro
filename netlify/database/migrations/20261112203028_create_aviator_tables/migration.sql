CREATE TABLE "aviator_bets" (
	"id" serial PRIMARY KEY,
	"round_id" integer NOT NULL,
	"round_number" integer NOT NULL,
	"uid" text NOT NULL,
	"username" text NOT NULL,
	"slot" smallint NOT NULL,
	"amount" numeric(14,2) NOT NULL,
	"auto_cashout" double precision,
	"status" text DEFAULT 'placing' NOT NULL,
	"cashout_multiplier" double precision,
	"payout" numeric(14,2) DEFAULT '0' NOT NULL,
	"was_auto_cashout" boolean DEFAULT false NOT NULL,
	"credit_state" text DEFAULT 'none' NOT NULL,
	"credit_amount" numeric(14,2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cashed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "aviator_rounds" (
	"id" serial PRIMARY KEY,
	"round_number" integer NOT NULL UNIQUE,
	"server_seed" text NOT NULL,
	"seed_hash" text NOT NULL,
	"crash_point" double precision NOT NULL,
	"rtp" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"growth_rate" double precision NOT NULL,
	"betting_starts_at" timestamp with time zone NOT NULL,
	"flight_starts_at" timestamp with time zone NOT NULL,
	"crash_at" timestamp with time zone NOT NULL,
	"next_round_at" timestamp with time zone NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aviator_settings" (
	"id" integer PRIMARY KEY,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "aviator_bets_round_uid_slot_uq" ON "aviator_bets" ("round_id","uid","slot") WHERE status in ('placing','active','cashed','lost');--> statement-breakpoint
CREATE INDEX "aviator_bets_uid_created_idx" ON "aviator_bets" ("uid","created_at");--> statement-breakpoint
CREATE INDEX "aviator_bets_round_idx" ON "aviator_bets" ("round_id");--> statement-breakpoint
CREATE INDEX "aviator_bets_credit_idx" ON "aviator_bets" ("uid","credit_state");--> statement-breakpoint
CREATE INDEX "aviator_rounds_created_idx" ON "aviator_rounds" ("created_at");--> statement-breakpoint
ALTER TABLE "aviator_bets" ADD CONSTRAINT "aviator_bets_round_id_aviator_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "aviator_rounds"("id");