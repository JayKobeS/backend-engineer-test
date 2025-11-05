import type { Pool } from "pg";

export async function createTables(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      height INTEGER UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inputs (
      id SERIAL PRIMARY KEY,
      tx_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      spent_utxo_txid TEXT NOT NULL,
      spent_utxo_index INTEGER NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS outputs (
      txid TEXT NOT NULL,
      idx INTEGER NOT NULL,
      address TEXT NOT NULL,
      value INTEGER NOT NULL,
      is_spent BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (txid, idx)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS balances (
      address TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      last_updated TIMESTAMP DEFAULT NOW()
    );
  `);
}
