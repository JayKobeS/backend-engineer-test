import { Pool } from "pg";
import { createTables } from "./schema";

let dbPool: Pool | null = null;

export function getDbPool(): Pool {
  if (!dbPool) {
    throw new Error("Database not initialized");
  }
  return dbPool;
}

export async function initDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  await createTables(pool);
  dbPool = pool;
}
