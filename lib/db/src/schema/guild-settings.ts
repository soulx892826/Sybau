import { createInsertSchema } from "drizzle-zod";
import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const guildSettingsTable = pgTable(
  "guild_settings",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    notificationChannelId: text("notification_channel_id"),
    dwcRoleId: text("dwc_role_id"),
    scammerRoleId: text("scammer_role_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("guild_settings_guild_unique").on(table.guildId)],
);

export const insertGuildSettingsSchema = createInsertSchema(
  guildSettingsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertGuildSettings = z.infer<typeof insertGuildSettingsSchema>;
export type GuildSettings = typeof guildSettingsTable.$inferSelect;