import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  smallint,
  text,
  boolean,
  doublePrecision,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Aviator: one row per round. The crash point is derived from server_seed
// (provably fair) and only revealed to clients after the round has crashed.
export const aviatorRounds = pgTable(
  "aviator_rounds",
  {
    id: serial().primaryKey(),
    roundNumber: integer("round_number").notNull().unique(),
    serverSeed: text("server_seed").notNull(),
    seedHash: text("seed_hash").notNull(),
    crashPoint: doublePrecision("crash_point").notNull(),
    rtp: doublePrecision().notNull(),
    maxMultiplier: doublePrecision("max_multiplier").notNull(),
    growthRate: doublePrecision("growth_rate").notNull(),
    bettingStartsAt: timestamp("betting_starts_at", { withTimezone: true }).notNull(),
    flightStartsAt: timestamp("flight_starts_at", { withTimezone: true }).notNull(),
    crashAt: timestamp("crash_at", { withTimezone: true }).notNull(),
    nextRoundAt: timestamp("next_round_at", { withTimezone: true }).notNull(),
    settled: boolean().notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("aviator_rounds_created_idx").on(t.createdAt)],
);

// Aviator: one row per bet slot (each player has two independent slots per round).
export const aviatorBets = pgTable(
  "aviator_bets",
  {
    id: serial().primaryKey(),
    roundId: integer("round_id").notNull().references(() => aviatorRounds.id),
    roundNumber: integer("round_number").notNull(),
    uid: text().notNull(),
    username: text().notNull(),
    slot: smallint().notNull(),
    amount: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    autoCashout: doublePrecision("auto_cashout"),
    // placing | active | cashed | lost | cancelled | void
    status: text().notNull().default("placing"),
    cashoutMultiplier: doublePrecision("cashout_multiplier"),
    payout: numeric({ precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    wasAutoCashout: boolean("was_auto_cashout").notNull().default(false),
    // none | pending | crediting | credited
    creditState: text("credit_state").notNull().default("none"),
    creditAmount: numeric("credit_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cashedAt: timestamp("cashed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("aviator_bets_round_uid_slot_uq")
      .on(t.roundId, t.uid, t.slot)
      .where(sql`status in ('placing','active','cashed','lost')`),
    index("aviator_bets_uid_created_idx").on(t.uid, t.createdAt),
    index("aviator_bets_round_idx").on(t.roundId),
    index("aviator_bets_credit_idx").on(t.uid, t.creditState),
  ],
);

// Aviator: admin-configurable settings (single row, id = 1).
export const aviatorSettings = pgTable("aviator_settings", {
  id: integer().primaryKey(),
  data: jsonb().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
