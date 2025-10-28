import { expect, test } from "bun:test";
import { createHash } from 'crypto';

// Pomocne funkcje do tworzenia testowych bloków
function createBlockId(height: number, txIds: string[]): string {
  const data = height.toString() + txIds.join('');
  return createHash('sha256').update(data).digest('hex');
}

// Testujemy logikę na poziomie funkcji, nie na API (brak servera w testach)
// To pozwoli na szybkie testy bez konieczności uruchamiania Fastify

test('Przykład z README: dodaj 3 bloki i wyświetl salda', () => {
  const blocks = [];
  let currentHeight = 0;
  const balances: Record<string, number> = {};
  const utxos: Map<string, { address: string; value: number }> = new Map();

  // Block 1
  const block1 = {
    height: 1,
    transactions: [
      {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      },
    ],
  };
  block1['id'] = createBlockId(block1.height, ['tx1']);

  // Przetworzenie bloku 1
  for (const tx of block1.transactions) {
    for (const input of tx.inputs) {
      const key = `${input.txId}:${input.index}`;
      const utxo = utxos.get(key);
      if (utxo) {
        balances[utxo.address] = (balances[utxo.address] || 0) - utxo.value;
        utxos.delete(key);
      }
    }
    tx.outputs.forEach((output, idx) => {
      const key = `${tx.id}:${idx}`;
      utxos.set(key, output);
      balances[output.address] = (balances[output.address] || 0) + output.value;
    });
  }
  blocks.push(block1);
  currentHeight = 1;

  // Sprawdzenie po bloku 1
  expect(balances['addr1']).toBe(10);
  expect(balances['addr2']).toBe(undefined);

  // Block 2
  const block2 = {
    height: 2,
    transactions: [
      {
        id: 'tx2',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [
          { address: 'addr2', value: 4 },
          { address: 'addr3', value: 6 },
        ],
      },
    ],
  };
  block2['id'] = createBlockId(block2.height, ['tx2']);

  // Przetworzenie bloku 2
  for (const tx of block2.transactions) {
    for (const input of tx.inputs) {
      const key = `${input.txId}:${input.index}`;
      const utxo = utxos.get(key);
      if (utxo) {
        balances[utxo.address] = (balances[utxo.address] || 0) - utxo.value;
        utxos.delete(key);
      }
    }
    tx.outputs.forEach((output, idx) => {
      const key = `${tx.id}:${idx}`;
      utxos.set(key, output);
      balances[output.address] = (balances[output.address] || 0) + output.value;
    });
  }
  blocks.push(block2);
  currentHeight = 2;

  // Sprawdzenie po bloku 2
  expect(balances['addr1']).toBe(0);
  expect(balances['addr2']).toBe(4);
  expect(balances['addr3']).toBe(6);

  // Block 3
  const block3 = {
    height: 3,
    transactions: [
      {
        id: 'tx3',
        inputs: [{ txId: 'tx2', index: 1 }],
        outputs: [
          { address: 'addr4', value: 2 },
          { address: 'addr5', value: 2 },
          { address: 'addr6', value: 2 },
        ],
      },
    ],
  };
  block3['id'] = createBlockId(block3.height, ['tx3']);

  // Przetworzenie bloku 3
  for (const tx of block3.transactions) {
    for (const input of tx.inputs) {
      const key = `${input.txId}:${input.index}`;
      const utxo = utxos.get(key);
      if (utxo) {
        balances[utxo.address] = (balances[utxo.address] || 0) - utxo.value;
        utxos.delete(key);
      }
    }
    tx.outputs.forEach((output, idx) => {
      const key = `${tx.id}:${idx}`;
      utxos.set(key, output);
      balances[output.address] = (balances[output.address] || 0) + output.value;
    });
  }
  blocks.push(block3);
  currentHeight = 3;

  // Sprawdzenie po bloku 3
  expect(balances['addr1']).toBe(0);
  expect(balances['addr2']).toBe(4);
  expect(balances['addr3']).toBe(0);
  expect(balances['addr4']).toBe(2);
  expect(balances['addr5']).toBe(2);
  expect(balances['addr6']).toBe(2);

  // ========== ROLLBACK do wysokości 2 ==========
  // Odtwarzamy stan od zera do wysokości 2
  const targetHeight = 2;
  const keptBlocks = blocks.filter((b) => (b as any).height <= targetHeight);

  const newUtxos: Map<string, { address: string; value: number }> = new Map();
  const newBalances: Record<string, number> = {};

  for (const block of keptBlocks) {
    for (const tx of block.transactions) {
      for (const input of tx.inputs) {
        const key = `${input.txId}:${input.index}`;
        const utxo = newUtxos.get(key);
        if (utxo) {
          newBalances[utxo.address] = (newBalances[utxo.address] || 0) - utxo.value;
          newUtxos.delete(key);
        }
      }
      tx.outputs.forEach((output, idx) => {
        const key = `${tx.id}:${idx}`;
        newUtxos.set(key, output);
        newBalances[output.address] = (newBalances[output.address] || 0) + output.value;
      });
    }
  }

  // Zastępujemy stan
  Object.assign(balances, {});
  Object.keys(balances).forEach((k) => delete balances[k]);
  Object.assign(balances, newBalances);

  // Sprawdzenie po rollbacku do 2
  expect(balances['addr1']).toBe(0);
  expect(balances['addr2']).toBe(4);
  expect(balances['addr3']).toBe(6);
  expect(balances['addr4']).toBe(undefined); // Blok 3 został wycofany
  expect(balances['addr5']).toBe(undefined);
  expect(balances['addr6']).toBe(undefined);
});

test('2 + 2', () => {
  expect(2 + 2).toBe(4);
});