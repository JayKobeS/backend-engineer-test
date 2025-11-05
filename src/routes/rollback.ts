import type { FastifyInstance } from "fastify";
import { getDbPool } from "../db/pool";
import type { AppState } from "../interfaces";

export async function registerRollbackRoutes(app: FastifyInstance, state: AppState) {
  app.post('/rollback', async (request, reply) => {
    try {
      const targetHeight = Number((request.query as any)?.height);

      if (!Number.isFinite(targetHeight) || targetHeight < 1) {
        return reply.status(400).send({ error: 'Invalid height parameter' });
      }
      if (targetHeight > state.currentHeight) {
        return reply.status(400).send({ error: 'Target height cannot be greater than current height' });
      }

      const dbPool = getDbPool();

      const deletedTxsResult = await dbPool.query(`
        SELECT t.id
        FROM transactions t
        JOIN blocks b ON t.block_id = b.id
        WHERE b.height > $1
      `, [targetHeight]);
      const deletedTxIds = deletedTxsResult.rows.map((row: any) => row.id);

      if (deletedTxIds.length > 0) {
        const placeholders = deletedTxIds.map((_, i) => `$${i + 1}`).join(',');
        await dbPool.query(`
          UPDATE outputs
          SET is_spent = FALSE
          WHERE (txid, idx) IN (
            SELECT spent_utxo_txid, spent_utxo_index
            FROM inputs
            WHERE tx_id IN (${placeholders})
          )
        `, deletedTxIds);
      }

      if (deletedTxIds.length > 0) {
        const placeholders = deletedTxIds.map((_, i) => `$${i + 1}`).join(',');
        await dbPool.query(`
          DELETE FROM outputs
          WHERE txid IN (${placeholders})
        `, deletedTxIds);
      }

      await dbPool.query('DELETE FROM blocks WHERE height > $1', [targetHeight]);

      if (deletedTxIds.length > 0) {
        const placeholders = deletedTxIds.map((_, i) => `$${i + 1}`).join(',');
        await dbPool.query(`
          DELETE FROM inputs
          WHERE tx_id IN (${placeholders})
        `, deletedTxIds);
      }

      // rebuild balances from UTXOs
      const result = await dbPool.query(`
        SELECT address, COALESCE(SUM(value), 0) as balance
        FROM outputs
        WHERE is_spent = FALSE
        GROUP BY address
      `);

      await dbPool.query('DELETE FROM balances');

      const newBalances: Record<string, number> = {};
      for (const row of result.rows) {
        await dbPool.query('INSERT INTO balances (address, balance) VALUES ($1, $2)', [row.address, row.balance]);
        newBalances[row.address] = row.balance;
      }

      // rebuild in-memory state from kept blocks
      const keptBlocks = state.blocks.filter((b) => b.height <= targetHeight);

      const rebuiltUtxos: typeof state.utxos = new Map();
      const rebuiltBalances: Record<string, number> = {};

      for (const block of keptBlocks) {
        for (const tx of block.transactions) {
          for (const input of tx.inputs) {
            const utxoKey = `${input.txId}:${input.index}`;
            const utxo = rebuiltUtxos.get(utxoKey);
            if (utxo) {
              rebuiltBalances[utxo.address] = (rebuiltBalances[utxo.address] || 0) - utxo.value;
              rebuiltUtxos.delete(utxoKey);
            }
          }

          tx.outputs.forEach((output, idx) => {
            const utxoKey = `${tx.id}:${idx}`;
            rebuiltUtxos.set(utxoKey, output);
            rebuiltBalances[output.address] = (rebuiltBalances[output.address] || 0) + output.value;
          });
        }
      }

      // swap state
      state.blocks.length = 0; state.blocks.push(...keptBlocks);
      state.currentHeight = targetHeight;

      Object.keys(state.balances).forEach((k) => delete (state.balances as any)[k]);
      Object.assign(state.balances, newBalances);

      state.utxos.clear();
      for (const [k, v] of rebuiltUtxos) state.utxos.set(k, v);

      return { status: 'Rollback successful', height: state.currentHeight };
    } catch (error) {
      app.log.error(error as any);
      return reply.status(500).send({ error: 'Rollback failed', details: String(error) });
    }
  });
}
