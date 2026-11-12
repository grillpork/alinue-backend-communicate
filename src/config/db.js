import { neon } from "@neondatabase/serverless";

export function getDb(c) {
  const rawUrl = c?.env?.DATABASE_URL || process.env.DATABASE_URL;

  if (!rawUrl) {
    throw new Error("DATABASE_URL is not configured in environment variables");
  }

  const connectionString = String(rawUrl).replace(/['"]/g, "").trim();

  return neon(connectionString);
}

