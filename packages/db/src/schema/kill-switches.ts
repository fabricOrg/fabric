import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared.js";

/**
 * KILL SWITCHES — platform circuit breakers staff flip during incidents (pause all SMS, disable a
 * provider, halt payments…). Platform-level (no tenant/RLS, like plugin_instances). `enabled` = the
 * capability is OPERATIONAL; flipping to false PAUSES it. Runtime paths (send/charge) check the
 * relevant key before acting. Every toggle records the actor + reason to the audit log.
 */
export const killSwitches = pgTable("kill_switches", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // stable id, e.g. "platform.sms_sending"
  label: text("label").notNull(),
  description: text("description").notNull(),
  scope: text("scope").notNull().default("platform"), // platform | provider | payments
  enabled: boolean("enabled").notNull().default(true), // true = operational; false = PAUSED
  lastReason: text("last_reason"),
  lastActorEmail: text("last_actor_email"),
  ...timestamps,
});

export type KillSwitch = typeof killSwitches.$inferSelect;
export type NewKillSwitch = typeof killSwitches.$inferInsert;
