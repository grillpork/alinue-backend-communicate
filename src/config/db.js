import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import * as relations from "../db/relations.js";

const fullSchema = { ...schema, ...relations };

let hasLoggedConnection = false;

function parseDbInfo(connectionString) {
  try {
    const u = new URL(connectionString);
    const dbName = u.pathname.replace(/^\//, "").split("?")[0];
    return { host: u.host, dbName, user: u.username };
  } catch {
    return { host: "unknown", dbName: "", user: "" };
  }
}

function cleanDatabaseUrl(rawUrl) {
  return String(rawUrl).replace(/['"]/g, "").trim();
}

let cachedClient = null;

function createPostgresClient(connectionString) {
  if (cachedClient) return cachedClient;

  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(sql, { schema: fullSchema });
  cachedClient = { sql, db };
  return cachedClient;
}

export function getDb(c) {
  const rawUrl = c?.env?.DATABASE_URL || process.env.DATABASE_URL;

  if (!rawUrl) {
    console.error("❌ [Database] Connection failed: DATABASE_URL is not configured");
    throw new Error("DATABASE_URL is not configured in environment variables");
  }

  const connectionString = cleanDatabaseUrl(rawUrl);
  const { sql, db } = createPostgresClient(connectionString);

  if (!hasLoggedConnection) {
    const info = parseDbInfo(connectionString);
    hasLoggedConnection = true;

    // Ping ทดสอบการเชื่อมต่อจริงและแสดง Log
    Promise.resolve()
      .then(async () => {
        const start = Date.now();
        await sql`SELECT 1`;
        const latency = Date.now() - start;
        console.log(
          `✅ [Database] Connected successfully to VPS PostgreSQL! [Host: ${info.host}] [DB: ${info.dbName}] (${latency}ms)`
        );
      })
      .catch((err) => {
        console.error(
          `❌ [Database] Connection failed [Host: ${info.host}] [DB: ${info.dbName}]:`,
          err.message
        );
      });
  }

  sql.db = db;
  return sql;
}

export function getDrizzle(c) {
  const sql = getDb(c);
  return sql.db;
}

export { schema, relations };
