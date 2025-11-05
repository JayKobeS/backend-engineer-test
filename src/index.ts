import Fastify from 'fastify';
import { initDb } from './db/pool';
import { registerRootRoutes } from './routes/root';
import { registerBlocksRoutes } from './routes/blocks';
import { registerBalanceRoutes } from './routes/balance';
import { registerRollbackRoutes } from './routes/rollback';
import { registerResetRoutes } from './routes/additionalFunction';
import type { Output, Block, AppState } from './interfaces';

const fastify = Fastify({ logger: true });

const state = {
  blocks: [] as Block[],
  currentHeight: 0,
  balances: {} as Record<string, number>,
  utxos: new Map<string, Output>(),
  reset() {
    this.blocks.length = 0;
    this.currentHeight = 0;
    Object.keys(this.balances).forEach((k) => delete (this.balances as any)[k]);
    this.utxos.clear();
  },
};

try {
  await initDb();

  await registerRootRoutes(fastify);
  await registerBlocksRoutes(fastify, state);
  await registerBalanceRoutes(fastify);
  await registerRollbackRoutes(fastify, state);
  await registerResetRoutes(fastify, state);

  await fastify.listen({ port: 3000, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}