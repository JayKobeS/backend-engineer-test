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

async function testPostgres(pool: Pool) {
  const id = randomUUID();
  const name = 'Satoshi';
  const email = 'Nakamoto';

  await pool.query(`DELETE FROM users;`);

  await pool.query(`
    INSERT INTO users (id, name, email)
    VALUES ($1, $2, $3);
  `, [id, name, email]);

  const { rows } = await pool.query(`
    SELECT * FROM users;
  `);

  console.log('USERS', rows);
}

async function createTables(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
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
  await testPostgres(pool);
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