import type { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { getDbPool } from "../db/pool";
import type { Block, AppState } from "../interfaces";

export async function registerBlocksRoutes(app: FastifyInstance, state: AppState) {
  app.post('/blocks', async (request, reply) => {
    try {
      const block = request.body as Block;

      // Height validation
      if (state.currentHeight === 0) {
        if (block.height !== 1) {
          return reply.status(400).send({ error: 'First block must have height = 1' });
        }
      } else if (block.height !== state.currentHeight + 1) {
        return reply.status(400).send({ error: 'Invalid block height' });
      }

      // Validate inputs reference existing UTXOs and sums match
      for (const transaction of block.transactions) {
        let sumInputs = 0;
        let sumOutputs = 0;

        for (const input of transaction.inputs) {
          const utxoKey = `${input.txId}:${input.index}`;
          const utxo = state.utxos.get(utxoKey);
          if (!utxo) {
            return reply.status(400).send({ error: `Input not found: ${utxoKey}` });
          }
          sumInputs += utxo.value;
        }

        for (const output of transaction.outputs) {
          sumOutputs += output.value;
        }

        if (sumInputs !== sumOutputs && transaction.inputs.length > 0) {
          return reply.status(400).send({ error: 'Input and output values do not match' });
        }
      }

      // Validate block id (sha256(height + txIds))
      let dataToHash = block.height.toString();
      for (const transaction of block.transactions) dataToHash += transaction.id;
      const expectedBlockId = createHash('sha256').update(dataToHash).digest('hex');
      if (block.id !== expectedBlockId) {
        return reply.status(400).send({
          error: 'Invalid block id',
          expected: expectedBlockId,
          received: block.id,
          hashInput: dataToHash,
        });
      }

      const dbPool = getDbPool();

      await dbPool.query('INSERT INTO blocks (id, height) VALUES ($1, $2)', [block.id, block.height]);

      for (const tx of block.transactions) {
        await dbPool.query('INSERT INTO transactions (id, block_id) VALUES ($1, $2)', [tx.id, block.id]);

        for (const input of tx.inputs) {
          await dbPool.query(
            'INSERT INTO inputs (tx_id, spent_utxo_txid, spent_utxo_index) VALUES ($1, $2, $3)',
            [tx.id, input.txId, input.index]
          );
          await dbPool.query('UPDATE outputs SET is_spent = TRUE WHERE txid = $1 AND idx = $2', [input.txId, input.index]);
        }

        for (let idx = 0; idx < tx.outputs.length; idx++) {
          const output = tx.outputs[idx];
          await dbPool.query(
            'INSERT INTO outputs (txid, idx, address, value, is_spent) VALUES ($1, $2, $3, $4, $5)',
            [tx.id, idx, output.address, output.value, false]
          );
        }
      }

      // Update in-memory UTXO set and balances
      for (const transaction of block.transactions) {
        for (const input of transaction.inputs) {
          const utxoKey = `${input.txId}:${input.index}`;
          const utxo = state.utxos.get(utxoKey);
          if (utxo) {
            state.balances[utxo.address] = (state.balances[utxo.address] || 0) - utxo.value;
          }
          state.utxos.delete(utxoKey);
        }

        transaction.outputs.forEach((output, index) => {
          const utxoKey = `${transaction.id}:${index}`;
          state.utxos.set(utxoKey, output);
          state.balances[output.address] = (state.balances[output.address] || 0) + output.value;
        });
      }

      // Persist balances snapshot
      for (const [address, balance] of Object.entries(state.balances)) {
        await dbPool.query(
          `INSERT INTO balances (address, balance) VALUES ($1, $2)
           ON CONFLICT (address) DO UPDATE SET balance = $2, last_updated = NOW()`,
          [address, balance]
        );
      }

      state.blocks.push(block);
      state.currentHeight = block.height;

      return { status: 'Block accepted', height: state.currentHeight };
    } catch (error) {
      app.log.error(error as any);
      return reply.status(500).send({ error: 'Database error', details: String(error) });
    }
  });

  app.get('/blocks', async (_request, reply) => {
    try {
      const dbPool = getDbPool();
      const result = await dbPool.query('SELECT id, height FROM blocks ORDER BY height');
      return { blocks: result.rows, count: result.rows.length, currentHeight: state.currentHeight };
    } catch (error) {
      app.log.error(error as any);
      return reply.status(500).send({ error: 'Database error', details: String(error) });
    }
  });
}
