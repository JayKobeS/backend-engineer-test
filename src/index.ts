import Fastify from 'fastify';
import { Pool } from 'pg';
import { randomUUID, createHash} from 'crypto';

const fastify = Fastify({ logger: true });

interface Output {
  address: string;
  value: number;
}

interface Input {
  txId: string;
  index: number;
}

interface Transaction {
  id: string;
  inputs: Input[];
  outputs: Output[];
}

interface Block {
  id: string;
  height: number;
  transactions: Transaction[];
}

const blocks: Block[] = [];
let currentHeight = 0;
const balances: Record<string, number> = {}; // address , balance

const utxos: Map<string, Output> = new Map(); // key: `${txId}:${index}`

// Database pool - będzie ustawiony w bootstrap()
let dbPool: Pool | null = null;



fastify.get('/', async (request, reply) => {
  return { welcome: 'in blockchain' };
});

fastify.post('/blocks', async (request, reply) => {
  try {
    const block = request.body as Block;

    /*
     Checks if the block height is valid
     */
    if (currentHeight === 0) {
      if (block.height !== 1) {
        return reply.status(400).send({
          error: 'First block must have height = 1'
        });
      }
    } else {
      if (block.height !== currentHeight + 1) {
        return reply.status(400).send({
          error: `Invalid block height`
        });
      }
    }

    /*
    Validation: - each input must reference a valid unspent output (UTXO)
    */
    for (const transaction of block.transactions) {
      let sumInputs = 0;
      let sumOutputs = 0;

      for (const input of transaction.inputs) {
        const utxoKey = `${input.txId}:${input.index}`;
        const utxo = utxos.get(utxoKey);

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

    let dataToHash = block.height.toString();
    for (const transaction of block.transactions) {
      dataToHash += transaction.id;
    }
    const expectedBlockId = createHash('sha256').update(dataToHash).digest('hex'); // height + transaction IDs

    if (block.id !== expectedBlockId) {
      return reply.status(400).send({
        error: 'Invalid block id',
        expected: expectedBlockId,
        received: block.id,
        hashInput: dataToHash,
      });
    }

    if (!dbPool) {
      return reply.status(500).send({ error: 'Database not initialized' });
    }

    await dbPool.query(
      'INSERT INTO blocks (id, height) VALUES ($1, $2)',
      [block.id, block.height]
    );

    for (const tx of block.transactions) {
      await dbPool.query(
        'INSERT INTO transactions (id, block_id) VALUES ($1, $2)',
        [tx.id, block.id]
      );


      for (const input of tx.inputs) {
        await dbPool.query(
          'INSERT INTO inputs (tx_id, spent_utxo_txid, spent_utxo_index) VALUES ($1, $2, $3)',
          [tx.id, input.txId, input.index]
        );

        await dbPool.query(
          'UPDATE outputs SET is_spent = TRUE WHERE txid = $1 AND idx = $2',
          [input.txId, input.index]
        );
      }

      for (let idx = 0; idx < tx.outputs.length; idx++) {
        const output = tx.outputs[idx];
        await dbPool.query(
          'INSERT INTO outputs (txid, idx, address, value, is_spent) VALUES ($1, $2, $3, $4, $5)',
          [tx.id, idx, output.address, output.value, false]
        );
      }
    }

    for (const transaction of block.transactions) {
      // Removes spent UTXOs
      for (const input of transaction.inputs) {
        const utxoKey = `${input.txId}:${input.index}`;
        const utxo = utxos.get(utxoKey);

        if (utxo) {
          balances[utxo.address] = (balances[utxo.address] || 0) - utxo.value; // Update balance - decrease
        }

        utxos.delete(utxoKey);
      }

      transaction.outputs.forEach((output, index) => {
        const utxoKey = `${transaction.id}:${index}`;
        utxos.set(utxoKey, output);

        balances[output.address] = (balances[output.address] || 0) + output.value; // Update balance - increase
      });
    }

    // update balances in database
    for (const [address, balance] of Object.entries(balances)) {
      await dbPool.query(
        `INSERT INTO balances (address, balance) VALUES ($1, $2) 
         ON CONFLICT (address) DO UPDATE SET balance = $2, last_updated = NOW()`,
        [address, balance]
      );
    }

    blocks.push(block);
    currentHeight = block.height;

    return { status: 'Block accepted', height: currentHeight };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Database error', details: String(error) });
  }
});

fastify.get('/balance/:address', async (request, reply) => {
  try {
    const params = request.params as { address: string };
    const address = params.address;

    if (!dbPool) {
      return reply.status(500).send({ error: 'Database not initialized' });
    }

    // take balance from database
    const result = await dbPool.query(
      'SELECT balance FROM balances WHERE address = $1',
      [address]
    );

    const balance = result.rows.length > 0 ? result.rows[0].balance : 0;
    return { address, balance };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Database error', details: String(error) });
  }
});

fastify.post('/rollback', async (request, reply) => {
  try {
    const targetHeight = Number((request.query as any)?.height);

    if (!Number.isFinite(targetHeight) || targetHeight < 1) {
      return reply.status(400).send({ error: 'Invalid height parameter' });
    }

    if (targetHeight > currentHeight) {
      return reply.status(400).send({ error: 'Target height cannot be greater than current height' });
    }

    if (!dbPool) {
      return reply.status(500).send({ error: 'Database not initialized' });
    }

    // First, get all transactions that will be deleted (height > targetHeight)
    const deletedTxsResult = await dbPool.query(`
      SELECT t.id
      FROM transactions t
      JOIN blocks b ON t.block_id = b.id
      WHERE b.height > $1
    `, [targetHeight]);

    const deletedTxIds = deletedTxsResult.rows.map((row: any) => row.id);

    // Step 1: Reset all outputs that were marked as spent by deleted transactions back to unspent
    // These outputs were created BEFORE the deleted blocks
    if (deletedTxIds.length > 0) {
      const placeholders = deletedTxIds.map((_: any, i: number) => `$${i + 1}`).join(',');
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

    // Step 2: Delete all outputs that were created by deleted transactions
    if (deletedTxIds.length > 0) {
      const placeholders = deletedTxIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      await dbPool.query(`
        DELETE FROM outputs
        WHERE txid IN (${placeholders})
      `, deletedTxIds);
    }

    // Step 3: Delete blocks above targetHeight (cascades to transactions)
    await dbPool.query(
      'DELETE FROM blocks WHERE height > $1',
      [targetHeight]
    );

    // Step 4: Delete inputs from deleted transactions (not strictly needed with CASCADE but being explicit)
    if (deletedTxIds.length > 0) {
      const placeholders = deletedTxIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      await dbPool.query(`
        DELETE FROM inputs
        WHERE tx_id IN (${placeholders})
      `, deletedTxIds);
    }

    // rebuild balances
    const result = await dbPool.query(`
      SELECT address, COALESCE(SUM(value), 0) as balance
      FROM outputs
      WHERE is_spent = FALSE
      GROUP BY address
    `);

    // Delete existing balances
    await dbPool.query('DELETE FROM balances');

    const newBalances: Record<string, number> = {};
    for (const row of result.rows) {
      await dbPool.query(
        'INSERT INTO balances (address, balance) VALUES ($1, $2)',
        [row.address, row.balance]
      );
      newBalances[row.address] = row.balance;
    }

    // rebuild in-memory structures
    const keptBlocks = blocks.filter(b => b.height <= targetHeight);

    const rebuiltUtxos: Map<string, Output> = new Map();
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

    // Change in-memory structures to rebuilt ones
    Object.keys(balances).forEach(k => delete balances[k]);
    Object.assign(balances, rebuiltBalances);

    utxos.clear();
    for (const [k, v] of rebuiltUtxos) utxos.set(k, v);

    blocks.length = 0;
    blocks.push(...keptBlocks);

    currentHeight = targetHeight;

    return { status: 'Rollback successful', height: currentHeight };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Rollback failed', details: String(error) });
  }
});

fastify.post('/reset', async (request, reply) => {
  try {
    if (!dbPool) {
      return reply.status(500).send({ error: 'Database not initialized' });
    }

    // Delete in correct order to avoid FK conflicts
    await dbPool.query('DELETE FROM outputs');
    await dbPool.query('DELETE FROM inputs');
    await dbPool.query('DELETE FROM transactions');
    await dbPool.query('DELETE FROM blocks');
    await dbPool.query('DELETE FROM balances');

    blocks.length = 0;
    currentHeight = 0;
    Object.keys(balances).forEach(key => delete balances[key]);
    utxos.clear();

    return {
      status: 'Reset successful',
      currentHeight,
      blocksCount: blocks.length,
      utxosCount: utxos.size,
      balancesCount: Object.keys(balances).length
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Reset failed', details: String(error) });
  }
});

fastify.get('/blocks', async (request, reply) => {
  try {
    if (!dbPool) {
      return reply.status(500).send({ error: 'Database not initialized' });
    }
    const result = await dbPool.query(
      'SELECT id, height FROM blocks ORDER BY height'
    );

    return {
      blocks: result.rows,
      count: result.rows.length,
      currentHeight: currentHeight
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Database error', details: String(error) });
  }
});

async function createTables(pool: Pool) {
  // Table of blocks
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      height INTEGER UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Table of transactions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE
    );
  `);

  // Table of inputs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inputs (
      id SERIAL PRIMARY KEY,
      tx_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      spent_utxo_txid TEXT NOT NULL,
      spent_utxo_index INTEGER NOT NULL
    );
  `);

  // Table of outputs (UTXO)
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

  // Table balances
  await pool.query(`
    CREATE TABLE IF NOT EXISTS balances (
      address TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      last_updated TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function bootstrap() {
  console.log('Bootstrapping...');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({
    connectionString: databaseUrl
  });

  await createTables(pool);
  
  // Przechowujemy pool globalnie
  dbPool = pool;
  console.log('Database connected and tables created');
}

try {
  await bootstrap();
  await fastify.listen({
    port: 3000,
    host: '0.0.0.0'
  })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
};