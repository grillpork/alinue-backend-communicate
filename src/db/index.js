import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import * as relations from "./relations.js";

export * from "./schema.js";
export * from "./relations.js";

export const fullSchema = { ...schema, ...relations };

export function getDrizzle(c) {
  const rawUrl = c?.env?.DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not configured in environment variables");
  }
  let connectionString = String(rawUrl).replace(/['"]/g, "").trim();
  connectionString = connectionString.replace(/:<([^>]+)>@/, ":$1@");
  const sql = postgres(connectionString, { max: 5 });
  return drizzle(sql, { schema: fullSchema });
}
