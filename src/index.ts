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
  const block = request.body as Block;

/*
 Checks if the block height is valid
 */
if(currentHeight === 0) {
    if(block.height !== 1) {
        return reply.status(400).send({ 
            error: 'First block must have height = 1' 
        });
    }
} else {
    if(block.height !== currentHeight + 1) {
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

  blocks.push(block);
  currentHeight = block.height;
  
  return { status: 'Block accepted', height: currentHeight };

}
);

fastify.get('/balance/:address', async (request, reply) => {
  const params = request.params as { address: string };
  const address = params.address;
  const balance = balances[address] || 0; // if address not found, balance is 0
  return { address, balance };

}
);

fastify.post('/rollback', async (request, reply) => {
  const targetHeight = Number((request.query as any)?.height);

  //
  if (!Number.isFinite(targetHeight) || targetHeight < 1) {
    return reply.status(400).send({ error: 'Invalid height parameter' });
  }

  if (targetHeight > currentHeight) {
    return reply.status(400).send({ error: 'Target height cannot be greater than current height'});
  }

  const keptBlocks = blocks.filter(b => b.height <= targetHeight);

  // Rebuild UTXO set and balances from kept blocks
  const rebuiltUtxos: Map<string, Output> = new Map();
  const rebuiltBalances: Record<string, number> = {};

  for (const block of keptBlocks) {
    for (const tx of block.transactions) {
      // Delete spent inputs
      for (const input of tx.inputs) {
        const utxoKey = `${input.txId}:${input.index}`;
        const utxo = rebuiltUtxos.get(utxoKey);
        if (utxo) {
          rebuiltBalances[utxo.address] = (rebuiltBalances[utxo.address] || 0) - utxo.value;
          rebuiltUtxos.delete(utxoKey);
        }
      }

      // Create new outputs
      tx.outputs.forEach((output, idx) => {
        const utxoKey = `${tx.id}:${idx}`;
        rebuiltUtxos.set(utxoKey, output);
        rebuiltBalances[output.address] = (rebuiltBalances[output.address] || 0) + output.value;
      });
    }
  }

  // Change global state to rebuilt state
  Object.keys(balances).forEach(k => delete balances[k]);
  Object.assign(balances, rebuiltBalances);

  utxos.clear();
  for (const [k, v] of rebuiltUtxos) utxos.set(k, v);

  blocks.length = 0;
  blocks.push(...keptBlocks);

  currentHeight = targetHeight;

  return { status: 'Rollback successful', height: currentHeight };
})

fastify.post('/reset', async (request, reply) => {
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
});

fastify.get('/blocks', async (request, reply) => {
  return {
    blocks: blocks,
    count: blocks.length,
    currentHeight: currentHeight
  };
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