// Set these after deploying to Base Sepolia
export const ESCROW_ADDRESS = (import.meta.env.VITE_ESCROW_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS ||
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`; // Circle testnet USDC

export const ESCROW_ABI = [
  {
    name: "intents",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "market", type: "string" },
      { name: "isLong", type: "bool" },
      { name: "sizeUsd", type: "uint256" },
      { name: "deposit", type: "uint256" },
      { name: "triggerPrice", type: "uint256" },
      { name: "triggerAbove", type: "bool" },
      { name: "referencePrice", type: "uint256" },
      { name: "maxDeviationBps", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "solverFeeBps", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  },
  {
    name: "intentStatuses",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "entryPrices",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "IntentCreated",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      {
        name: "intent",
        type: "tuple",
        indexed: false,
        components: [
          { name: "user", type: "address" },
          { name: "market", type: "string" },
          { name: "isLong", type: "bool" },
          { name: "sizeUsd", type: "uint256" },
          { name: "deposit", type: "uint256" },
          { name: "triggerPrice", type: "uint256" },
          { name: "triggerAbove", type: "bool" },
          { name: "referencePrice", type: "uint256" },
          { name: "maxDeviationBps", type: "uint256" },
          { name: "expiry", type: "uint64" },
          { name: "solverFeeBps", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "IntentFilled",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "entryPrice", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentSettled",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "exitPrice", type: "uint256", indexed: false },
      { name: "pnl", type: "int256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
] as const;

export const STATUS_LABELS = ["OPEN", "FILLED", "SETTLED", "CANCELLED", "EXPIRED"] as const;

export interface VerifyRecord {
  intentId: string;
  event: "FILL" | "SETTLE";
  timestamp: number;
  reportedPx1e6: string;
  bookSnapshot: {
    coin: string;
    midPrice1e6: string;
    bids: { px: string; sz: string }[];
    asks: { px: string; sz: string }[];
  };
  explorerUrl: string;
}
