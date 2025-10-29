import { expect, test, describe } from "bun:test";
import { createHash } from 'crypto';

describe("POST /blocks", () => {
  test("Should accept correct block with height=1 ", async () => {
    const block = {
      id: createHash('sha256').update('3tx3').digest('hex'),
      height: 3,
      transaction: [
        {
          id: "tx3",
          inputs: [],
          outputs: [{ address: "address1", amount: 50 }]
          },
      ]
    };

    const response = await fetch("http://localhost:3000/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(block),
    });
    expect(response.status).toBe(200);
})
  test("Should reject block with incorrect height", async () => {
    const block = {
      id: createHash('sha256').update('2tx2').digest('hex'),
      height: 3,
      transaction: [
        {
          id: "tx2",
          inputs: [],
          outputs: [{ address: "address2", amount: 30 }]
        },
      ]
    };

    const response = await fetch("http://localhost:3000/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(block),
    });
    expect(response.status).toBe(400);
  })
});