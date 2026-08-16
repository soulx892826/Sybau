import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const vouchesTable = pgTable(
  "vouches",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 16 }).notNull(),
    guildId: text("guild_id").notNull(),
    targetUserId: text("target_user_id").notNull(),
    targetUsername: text("target_username").notNull(),
    giverUserId: text("giver_user_id").notNull(),
    giverUsername: text("giver_username").notNull(),
    product: text("product").notNull(),
    amount: text("amount").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    source: varchar("source", { length: 24 }).notNull().default("member"),
    adminUserId: text("admin_user_id"),
    adminUsername: text("admin_username"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("vouches_code_unique").on(table.code),
    index("vouches_guild_target_idx").on(table.guildId, table.targetUserId),
    index("vouches_giver_idx").on(table.guildId, table.giverUserId),
    index("vouches_created_at_idx").on(table.guildId, table.createdAt),
  ],
);

export const insertVouchSchema = createInsertSchema(vouchesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertVouch = z.infer<typeof insertVouchSchema>;
export type Vouch = typeof vouchesTable.$inferSelect;