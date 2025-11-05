export interface Output {
  address: string;
  value: number;
}

export interface Input {
  txId: string;
  index: number;
}

export interface Transaction {
  id: string;
  inputs: Input[];
  outputs: Output[];
}

export interface Block {
  id: string;
  height: number;
  transactions: Transaction[];
}

export interface AppState {
  blocks: Block[];
  currentHeight: number;
  balances: Record<string, number>;
  utxos: Map<string, Output>;
  reset(): void;
}
