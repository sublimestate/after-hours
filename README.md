# AfterHours 🌙

Cross-chain conditional intents for RWA perpetuals. Set a price trigger on Base; a solver executes on Hyperliquid's HIP-3 RWA markets with its own capital; settlement happens on Base from public Hyperliquid prices.

**The pitch:** RWA exposure from Base without bridging or pre-funding a Hyperliquid account — including when the venue is closed. The demo narrative: the weekend crude moves when TradeXYZ was the only venue trading.

## How it works

1. **Create** — User signs an EIP-712 intent (market, side, size, trigger price, reference price, max deviation bound, expiry) and deposits USDC into `RwaIntentEscrow` on Base.
2. **Watch** — The solver polls Hyperliquid order books. When the trigger fires *and* the price is within the deviation bound, it executes on Hyperliquid testnet with its own capital.
3. **Fill** — Solver calls `fillIntent(id, entryPrice)` on Base. The contract enforces the symmetric bound `|entry − ref| × 10000 ≤ maxDeviationBps × ref` — a fill outside it reverts.
4. **Settle** — Solver calls `settleIntent(id, exitPrice)`. PnL is computed on-chain; the user is paid from escrow, and the solver covers profits (or keeps losses) from its own balance.
5. **Verify** — Every fill/settle records the reported price plus the top-5 order-book snapshot at that moment. The frontend's verify panel cross-checks the solver's price against public book data with an explorer link.

## Trust model (read this)

This is an MVP with an explicit trust assumption: **the solver is a trusted operator.**

- The solver reports `entryPrice`/`exitPrice`. The deviation bound constrains *how far* it can lie, not *whether* it lies within the bound.
- The verify panel is the accountability mechanism: every reported price is published alongside the contemporaneous public order book, so misreporting is detectable after the fact.
- Settlement is atomic and on-chain: the solver cannot take the user's deposit; it can only trigger the contract's payout math. If the solver disappears after filling, funds are locked — there is no trustless exit in this version.
- What the contract *does* guarantee: signature authenticity, deposit custody, bound enforcement, expiry refunds, and replay protection — all covered by Foundry tests.

## Demo disclosure

The demo uses a **simulated weekend price gap** on Hyperliquid testnet (stated on-screen). Trigger evaluation, bound enforcement, on-chain fill/settle, and the verify panel are all real.

## Design note: we tested Base validity transactions as the trigger

We tried to eliminate the keeper entirely using Base's Cobalt validity transactions
(`base_sendRawTransactionValidity`, live on Base Sepolia): the idea was a fill transaction
that sits valid-but-unincluded until a price predicate becomes true — a protocol-native
conditional trigger with no polling bot.

**Result: it doesn't work for this use case, and we have the data.** On 2026-10-07 we
submitted validity transactions to Base Sepolia with expiries at +600 blocks and +15 blocks:
the +600-block transaction was rejected (`expires too far in the future`); the +15-block
control was accepted. Effective max lifetime is ~64 seconds — enough for MEV protection,
nowhere near a weekend hold.

So the keeper-polling trigger stands as the core design, and validity transactions are
demoted to a possible future use (settlement privacy). We're leaving this note here
because "we tested the new primitive and have receipts" is more useful than pretending
the first idea worked.

## Contracts

| Contract | Network | Address |
|---|---|---|
| RwaIntentEscrow | Base Sepolia | `0xb5af8a8bed7272b0b9b0144d58dc86912a6f7dd4` |
| USDC | Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Deployed 2026-10-08 ([tx](https://sepolia.basescan.org/tx/0x4db5352c06323d9e803b4fcd80b8c3f8543d9580e6c5d384cd0b022400c34d00)). Solver operator: `0xffb426Ea8aa9b9987788337dACAb44270a81083a`.

## Verified end-to-end on testnet (2026-10-08)

Full loop executed against the deployed contract: intent `0x17fb05b6…4938` (long $10 xyz:GOLD) created → solver evaluated trigger (`READY_TO_FILL`) → `fillIntent` at $4,135.45 ([tx](https://sepolia.basescan.org/tx/0x50e75dd2f18cd129af9843ed4fdec59eb37e26d0d0715c917f44165d8755c899)) → `settleIntent` at $4,218.16 ([tx](https://sepolia.basescan.org/tx/0xe2da4ef7e8ed1231adea14e8b81e45324938b7787193ebd3af0ec9bce2730c86)). Payout math confirmed on-chain: 12 + 0.20 PnL − 0.05 fee = 12.15 USDC.

Update 2026-10-10: the Hyperliquid execution leg is funded and live-verified. 15 USDC sits on the solver's xyz-dex margin (HIP-3 dexes keep separate margin accounts — moved via dex transfer). Two executor bugs fixed the same session: (1) the SDK's order helper only resolves native-dex assets, so `xyz:CL` threw "Unknown asset" — orders now go through the raw wire path with the HIP-3 global asset index resolved dynamically (`100000 + dexPosition*10000 + universeIndex`; xyz:CL=750029, xyz:GOLD=750003 on testnet); (2) the price feed (mainnet) and executor (testnet) were sharing one info URL — split into `HL_INFO_URL` and `HL_EXEC_INFO_URL`; isolated leverage is set because HIP-3 markets are isolated-only. Live check: a real IOC buy on xyz:GOLD testnet filled (0.0029 @ 4209.5) and was closed right after — solver flat at ~$14.87 USDC.

Demo caveat: xyz:CL's testnet book is empty, so IOC orders can't fill there — seed the book with the solver's own resting GTC orders first, or demo on xyz:GOLD, which has a live book.

## Repo layout

- `contracts/` — `RwaIntentEscrow.sol` (Foundry). 7 tests incl. a 256-run fuzz on the bound invariant, all passing.
- `solver/` — Trigger bot: HL price feed, trigger evaluation, order execution, on-chain settlement, verify records. 10 unit tests (`npm test`).
- `frontend/` — Vite + wagmi intent creation, my-intents list, verify panel.

## Running it

```bash
# Contracts
cd contracts && forge test

# Solver
cd solver && npm install
cp .env.example .env  # set OPERATOR_KEY, ESCROW_ADDRESS, BASE_RPC_URL
npm start

# Frontend
cd frontend && npm install
echo 'VITE_ESCROW_ADDRESS=0x...' > .env
npm run dev
```

The solver writes verify records to `solver/data/verify-records.json`; copy to `frontend/public/verify-records.json` for the verify panel (demo setup).
