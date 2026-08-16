import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env["DATABASE_URL"];

export const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5_000,
});
export const db = drizzle(pool, { schema });

export async function checkDatabaseConnection(): Promise<void> {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }

  await db.execute(sql`select 1`);
}

export * from "./schema";
