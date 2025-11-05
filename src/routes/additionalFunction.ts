import type { FastifyInstance } from "fastify";
import { getDbPool } from "../db/pool";
import type { AppState } from "../interfaces";

export async function registerResetRoutes(app: FastifyInstance, state: AppState) {
  app.post('/reset', async (_request, reply) => {
    try {
      const dbPool = getDbPool();

      await dbPool.query('DELETE FROM outputs');
      await dbPool.query('DELETE FROM inputs');
      await dbPool.query('DELETE FROM transactions');
      await dbPool.query('DELETE FROM blocks');
      await dbPool.query('DELETE FROM balances');

      state.reset();

      return {
        status: 'Reset successful',
        currentHeight: state.currentHeight,
        blocksCount: state.blocks.length,
        utxosCount: state.utxos.size,
        balancesCount: Object.keys(state.balances).length,
      };
    } catch (error) {
      app.log.error(error as any);
      return reply.status(500).send({ error: 'Reset failed', details: String(error) });
    }
  });
}
