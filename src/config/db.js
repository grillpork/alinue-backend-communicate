import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import * as relations from "../db/relations.js";

const fullSchema = { ...schema, ...relations };

function cleanDatabaseUrl(rawUrl) {
  return String(rawUrl).replace(/['"]/g, "").trim();
}

let cachedClient = null;
let cachedUrl = null;

function createClient(connectionString) {
  if (cachedClient && cachedUrl === connectionString) {
    return cachedClient;
  }

  const isNeon = connectionString.includes("neon.tech");

  if (isNeon) {
    const sql = neon(connectionString);
    const db = drizzleNeon(sql, { schema: fullSchema });
    sql.db = db;
    cachedClient = { sql, db };
    cachedUrl = connectionString;
    return cachedClient;
  } else {
    const sql = postgres(connectionString, {
      max: 1, // Single connection for serverless safety
      idle_timeout: 5,
      connect_timeout: 10,
    });
    const db = drizzlePostgres(sql, { schema: fullSchema });
    sql.db = db;
    cachedClient = { sql, db };
    cachedUrl = connectionString;
    return cachedClient;
  }
}

export function getDb(c) {
  const rawUrl = c?.env?.DATABASE_URL || process.env.DATABASE_URL;

  if (!rawUrl) {
    console.error("❌ [Database] Connection failed: DATABASE_URL is not configured");
    throw new Error("DATABASE_URL is not configured in environment variables");
  }

  const connectionString = cleanDatabaseUrl(rawUrl);
  const client = createClient(connectionString);
  return client.sql;
}

export function getDrizzle(c) {
  const rawUrl = c?.env?.DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not configured in environment variables");
  }
  const connectionString = cleanDatabaseUrl(rawUrl);
  const client = createClient(connectionString);
  return client.db;
}

export { schema, relations };
