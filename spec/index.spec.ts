import { expect, test, describe } from "bun:test";
import { createHash } from 'crypto';

describe("Blockchain Indexer API - Full Test Suite", () => {
  
  function calculateBlockId(height: number, txIds: string[]): string {
    const data = height.toString() + txIds.join('');
    return createHash('sha256').update(data).digest('hex');
  }

  async function resetDatabase() {
    const response = await fetch("http://localhost:3000/reset", { method: "POST" });
    if (!response.ok) throw new Error("Failed to reset database");
  }

  describe("GET / - Welcome Endpoint", () => {
    // Test 1
    test("Should return welcome message when accessing root", async () => {
      const response = await fetch("http://localhost:3000/");
      
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.welcome).toBe("in blockchain");
    });
  });

  describe("POST /blocks - Block Submission", () => {
    
    // Test 2
    test("Should accept the first block with height=1", async () => {
      await resetDatabase();
      const blockId = calculateBlockId(1, ["tx1"]);
      const block = {
        id: blockId,
        height: 1,
        transactions: [
          {
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }
        ]
      };

      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(block),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe("Block accepted");
      expect(json.height).toBe(1);
    });

    // Test 3
    test("Should reject first block if height is not 1", async () => {
      await resetDatabase();
      const blockId = calculateBlockId(2, ["tx1"]);
      const block = {
        id: blockId,
        height: 2,
        transactions: [
          {
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }
        ]
      };

      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(block),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBeDefined();
    });

    // Test 4
    test("Should reject block with invalid height sequence", async () => {
      await resetDatabase();
      
      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const block3Id = calculateBlockId(3, ["tx3"]);
      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block3Id,
          height: 3,
          transactions: [{
            id: "tx3",
            inputs: [],
            outputs: [{ address: "bob", value: 50 }]
          }]
        }),
      });

      expect(response.status).toBe(400);
    });

    // Test 5
    test("Should reject block with invalid SHA256 ID", async () => {
      await resetDatabase();
      const block = {
        id: "invalid_id_that_does_not_match_sha256",
        height: 1,
        transactions: [{
          id: "tx1",
          inputs: [],
          outputs: [{ address: "alice", value: 100 }]
        }]
      };

      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(block),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Invalid block id");
    });

    // Test 6
    test("Should reject block with mismatched input/output values", async () => {
      await resetDatabase();
      
      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const block2Id = calculateBlockId(2, ["tx2"]);
      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block2Id,
          height: 2,
          transactions: [{
            id: "tx2",
            inputs: [{ txId: "tx1", index: 0 }],
            outputs: [{ address: "bob", value: 50 }]
          }]
        }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Input and output values do not match");
    });

    // Test 7
    test("Should reject block trying to spend non-existent UTXO", async () => {
      await resetDatabase();
      const blockId = calculateBlockId(1, ["tx1"]);
      const block = {
        id: blockId,
        height: 1,
        transactions: [{
          id: "tx1",
          inputs: [{ txId: "non_existent_tx", index: 0 }],
          outputs: [{ address: "alice", value: 100 }]
        }]
      };

      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(block),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Input not found");
    });

    // Test 8
    test("Should successfully transfer funds between addresses", async () => {
      await resetDatabase();

      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const block2Id = calculateBlockId(2, ["tx2"]);
      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block2Id,
          height: 2,
          transactions: [{
            id: "tx2",
            inputs: [{ txId: "tx1", index: 0 }],
            outputs: [
              { address: "bob", value: 60 },
              { address: "charlie", value: 40 }
            ]
          }]
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe("Block accepted");
      expect(json.height).toBe(2);
    });
  });

  describe("GET /balance/:address - Balance Inquiry", () => {
    
    // Test 9
    test("Should return correct balance after receiving funds", async () => {
      await resetDatabase();
      const blockId = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: blockId,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const response = await fetch("http://localhost:3000/balance/alice");

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.address).toBe("alice");
      expect(json.balance).toBe(100);
    });

    // Test 10
    test("Should return 0 balance for non-existent address", async () => {
      await resetDatabase();

      const response = await fetch("http://localhost:3000/balance/unknown_address");

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.balance).toBe(0);
    });

    // Test 11
    test("Should update balance correctly after spending", async () => {
      await resetDatabase();

      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const block2Id = calculateBlockId(2, ["tx2"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block2Id,
          height: 2,
          transactions: [{
            id: "tx2",
            inputs: [{ txId: "tx1", index: 0 }],
            outputs: [{ address: "bob", value: 100 }]
          }]
        }),
      });

      const aliceResponse = await fetch("http://localhost:3000/balance/alice");
      const bobResponse = await fetch("http://localhost:3000/balance/bob");

      const aliceJson = await aliceResponse.json();
      const bobJson = await bobResponse.json();
      
      expect(aliceJson.balance).toBe(0);
      expect(bobJson.balance).toBe(100);
    });

    // Test 12
    test("Should correctly handle multiple outputs from single transaction", async () => {
      await resetDatabase();

      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [
              { address: "bob", value: 60 },
              { address: "charlie", value: 40 }
            ]
          }]
        }),
      });

      const bobResponse = await fetch("http://localhost:3000/balance/bob");
      const charlieResponse = await fetch("http://localhost:3000/balance/charlie");

      const bobJson = await bobResponse.json();
      const charlieJson = await charlieResponse.json();
      
      expect(bobJson.balance).toBe(60);
      expect(charlieJson.balance).toBe(40);
    });
  });

  describe("POST /rollback - Blockchain Rollback", () => {
    
    // Test 13
    test("Should rollback to previous height and undo transactions", async () => {
      await resetDatabase();

      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      // Block 2
      const block2Id = calculateBlockId(2, ["tx2"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block2Id,
          height: 2,
          transactions: [{
            id: "tx2",
            inputs: [{ txId: "tx1", index: 0 }],
            outputs: [
              { address: "bob", value: 60 },
              { address: "charlie", value: 40 }
            ]
          }]
        }),
      });

      const block3Id = calculateBlockId(3, ["tx3"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block3Id,
          height: 3,
          transactions: [{
            id: "tx3",
            inputs: [{ txId: "tx2", index: 0 }],
            outputs: [
              { address: "dave", value: 30 },
              { address: "eve", value: 30 }
            ]
          }]
        }),
      });

      const rollbackResponse = await fetch("http://localhost:3000/rollback?height=1", {
        method: "POST",
      });

      expect(rollbackResponse.status).toBe(200);
      const rollbackJson = await rollbackResponse.json();
      expect(rollbackJson.status).toBe("Rollback successful");
      expect(rollbackJson.height).toBe(1);

      const aliceBalance = await fetch("http://localhost:3000/balance/alice");
      const bobBalance = await fetch("http://localhost:3000/balance/bob");
      const charlieBalance = await fetch("http://localhost:3000/balance/charlie");
      const daveBalance = await fetch("http://localhost:3000/balance/dave");

      const alice = await aliceBalance.json();
      const bob = await bobBalance.json();
      const charlie = await charlieBalance.json();
      const dave = await daveBalance.json();

      expect(alice.balance).toBe(100);
      expect(bob.balance).toBe(0);
      expect(charlie.balance).toBe(0);
      expect(dave.balance).toBe(0);
    });

    // Test 14
    test("Should reject rollback with invalid height parameter", async () => {
      await resetDatabase();

      const response = await fetch("http://localhost:3000/rollback?height=invalid", {
        method: "POST",
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBeDefined();
    });

    // Test 15
    test("Should reject rollback to height greater than current height", async () => {
      await resetDatabase();
      const blockId = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: blockId,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const response = await fetch("http://localhost:3000/rollback?height=5", {
        method: "POST",
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("greater than current height");
    });

    // Test 16
    test("Should correctly handle rollback and re-adding of blocks", async () => {
      await resetDatabase();

      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const block2Id = calculateBlockId(2, ["tx2"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block2Id,
          height: 2,
          transactions: [{
            id: "tx2",
            inputs: [{ txId: "tx1", index: 0 }],
            outputs: [{ address: "bob", value: 100 }]
          }]
        }),
      });

      await fetch("http://localhost:3000/rollback?height=1", { method: "POST" });

      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block2Id,
          height: 2,
          transactions: [{
            id: "tx2",
            inputs: [{ txId: "tx1", index: 0 }],
            outputs: [{ address: "bob", value: 100 }]
          }]
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.height).toBe(2);
    });
  });

  describe("POST /reset - Reset System", () => {
    
    // Test 17
    test("Should clear all blocks and balances", async () => {
      const blockId = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: blockId,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const response = await fetch("http://localhost:3000/reset", { method: "POST" });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe("Reset successful");
      expect(json.currentHeight).toBe(0);
      expect(json.blocksCount).toBe(0);
      expect(json.balancesCount).toBe(0);

      const balanceResponse = await fetch("http://localhost:3000/balance/alice");
      const balanceJson = await balanceResponse.json();
      expect(balanceJson.balance).toBe(0);
    });

    // Test 18
    test("Should allow new blocks after reset", async () => {
      await resetDatabase();

      const blockId = calculateBlockId(1, ["tx1"]);
      const response = await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: blockId,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 50 }]
          }]
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.height).toBe(1);
    });
  });

  describe("GET /blocks - Block List", () => {
    
    // Test 19
    test("Should return empty block list after reset", async () => {
      await resetDatabase();

      const response = await fetch("http://localhost:3000/blocks");

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.count).toBe(0);
      expect(json.blocks.length).toBe(0);
      expect(json.currentHeight).toBe(0);
    });

    // Test 20
    test("Should return all blocks in order", async () => {
      await resetDatabase();

      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const block2Id = calculateBlockId(2, ["tx2"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block2Id,
          height: 2,
          transactions: [{
            id: "tx2",
            inputs: [{ txId: "tx1", index: 0 }],
            outputs: [{ address: "bob", value: 100 }]
          }]
        }),
      });

      const block3Id = calculateBlockId(3, ["tx3"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block3Id,
          height: 3,
          transactions: [{
            id: "tx3",
            inputs: [{ txId: "tx2", index: 0 }],
            outputs: [{ address: "charlie", value: 100 }]
          }]
        }),
      });

      const response = await fetch("http://localhost:3000/blocks");

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.count).toBe(3);
      expect(json.blocks.length).toBe(3);
      expect(json.currentHeight).toBe(3);
      
      expect(json.blocks[0].height).toBe(1);
      expect(json.blocks[0].id).toBe(block1Id);
      expect(json.blocks[1].height).toBe(2);
      expect(json.blocks[1].id).toBe(block2Id);
      expect(json.blocks[2].height).toBe(3);
      expect(json.blocks[2].id).toBe(block3Id);
    });

    // Test 21
    test("Should reflect block removal after rollback", async () => {
      await resetDatabase();

      const block1Id = calculateBlockId(1, ["tx1"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block1Id,
          height: 1,
          transactions: [{
            id: "tx1",
            inputs: [],
            outputs: [{ address: "alice", value: 100 }]
          }]
        }),
      });

      const block2Id = calculateBlockId(2, ["tx2"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block2Id,
          height: 2,
          transactions: [{
            id: "tx2",
            inputs: [{ txId: "tx1", index: 0 }],
            outputs: [{ address: "bob", value: 100 }]
          }]
        }),
      });

      const block3Id = calculateBlockId(3, ["tx3"]);
      await fetch("http://localhost:3000/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: block3Id,
          height: 3,
          transactions: [{
            id: "tx3",
            inputs: [{ txId: "tx2", index: 0 }],
            outputs: [{ address: "charlie", value: 100 }]
          }]
        }),
      });

      await fetch("http://localhost:3000/rollback?height=1", { method: "POST" });

      const response = await fetch("http://localhost:3000/blocks");

      const json = await response.json();
      expect(json.count).toBe(1);
      expect(json.blocks.length).toBe(1);
      expect(json.currentHeight).toBe(1);
    });
  });
});