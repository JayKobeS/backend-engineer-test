import type { FastifyInstance } from "fastify";
import { getDbPool } from "../db/pool";

export async function registerBalanceRoutes(app: FastifyInstance) {
  app.get('/balance/:address', async (request, reply) => {
    try {
      const { address } = (request.params as { address: string });
      const dbPool = getDbPool();
      const result = await dbPool.query('SELECT balance FROM balances WHERE address = $1', [address]);
      const balance = result.rows.length > 0 ? result.rows[0].balance : 0;
      return { address, balance };
    } catch (error) {
      app.log.error(error as any);
      return reply.status(500).send({ error: 'Database error', details: String(error) });
    }
  });
}
