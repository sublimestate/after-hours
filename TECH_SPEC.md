# AfterHours — Tech Spec

Solidity: `^0.8.24` (OpenZeppelin contracts). Solver/frontend: TypeScript (viem + wagmi).

## Repo layout
```
contracts/          # Foundry project
  src/RwaIntentEscrow.sol
  test/RwaIntentEscrow.t.sol
  script/Deploy.s.sol
solver/             # TypeScript service
  src/chain.ts      # Base Sepolia client, event subscription
  src/hlfeed.ts     # Hyperliquid price polling
  src/triggers.ts   # trigger + bound evaluation
  src/executor.ts   # Hyperliquid testnet order placement
  src/settler.ts    # fill/settle transactions on Base
  src/verify.ts     # book snapshots for the verify panel
frontend/           # Vite + wagmi
```

## 1. Contract — `RwaIntentEscrow.sol` (deploy: Base Sepolia, chain id 84532)

USDC: 6 decimals. Prices: 6 decimals (matches Hyperliquid `px` strings, e.g. `"88.626"` → `88626000`).

```solidity
struct Intent {
    address user;
    string  market;            // Hyperliquid coin, e.g. "xyz:GOLD"
    bool    isLong;
    uint256 sizeUsd;           // 1e6, notional. INVARIANT: sizeUsd <= deposit (1x max)
    uint256 deposit;           // 1e6, USDC locked
    uint256 triggerPrice;      // 1e6
    bool    triggerAbove;      // true: fill when mid >= triggerPrice
    uint256 referencePrice;    // 1e6, anchor for the deviation bound
    uint256 maxDeviationBps;   // bound: |fillPx - ref| * 10000 <= maxDeviationBps * ref
    uint64  expiry;            // unix seconds
    uint256 solverFeeBps;      // e.g. 50
    uint256 nonce;
}
enum Status { OPEN, FILLED, SETTLED, CANCELLED, EXPIRED }
```

Events: `IntentCreated(bytes32 indexed id, Intent intent)`, `IntentCancelled(bytes32 indexed id)`,
`IntentFilled(bytes32 indexed id, uint256 entryPrice)`, `IntentSettled(bytes32 indexed id, uint256 exitPrice, int256 pnl, uint256 fee)`.

EIP-712:
- Domain: `name = "AfterHours"`, `version = "1"`, `chainId = 84532`, `verifyingContract = <deployed>`.
- Type string: `Intent(address user,string market,bool isLong,uint256 sizeUsd,uint256 deposit,uint256 triggerPrice,bool triggerAbove,uint256 referencePrice,uint256 maxDeviationBps,uint64 expiry,uint256 solverFeeBps,uint256 nonce)`.
- `id = keccak256(abi.encode(intent))` — require unused.

Functions:
- `createIntent(Intent calldata i, bytes calldata sig)`:
  - `ecrecover` EIP-712 digest → must equal `i.user`.
  - `require(i.expiry > block.timestamp && i.sizeUsd > 0)`.
  - `require(i.deposit >= i.sizeUsd + i.sizeUsd * i.solverFeeBps / 10000)` — guarantees payout can never go negative at 1x.
  - `USDC.safeTransferFrom(i.user, address(this), i.deposit)`.
- `cancelIntent(bytes32 id)` — `msg.sender == intent.user`, status OPEN → CANCELLED, refund deposit.
- `fillIntent(bytes32 id, uint256 entryPrice)` — `msg.sender == solver` (immutable operator set at deploy; MVP), status OPEN, `block.timestamp < expiry`.
  - **Bound enforced on-chain:** `abs(int(entryPrice) - int(ref)) * 10000 <= maxDeviationBps * ref`, else revert.
  - Store entryPrice, status FILLED.
- `settleIntent(bytes32 id, uint256 exitPrice)` — solver only, status FILLED.
  - `pnl = int(sizeUsd) * (int(exitPrice) - int(entryPrice)) / int(entryPrice)`, negated if short. (Solidity: careful with signed division order — multiply before divide.)
  - `fee = sizeUsd * solverFeeBps / 10000`.
  - `payout = int(deposit) + pnl - int(fee)`; `require(payout >= 0)`.
  - Transfer `uint(payout)` USDC to user; remainder (`deposit - payout`) to solver. Status SETTLED.
- `expireUnfilled(bytes32 id)` — anyone; status OPEN and `block.timestamp >= expiry` → EXPIRED, refund.

Trust model (MVP): solver is a trusted operator; it reports entry/exit prices. Mitigations shipped in v1: bound rule enforced transparently on-chain; every price cross-checkable post-hoc via `verify.ts` snapshots + Hyperliquid explorer links. Document in README. v2: solver bond/slashing.

## 2. Solver bot

Env: `BASE_RPC_URL`, `OPERATOR_KEY`, `ESCROW_ADDRESS`, `USDC_ADDRESS`,
`HL_TESTNET_KEY` (API wallet), `HL_INFO_URL` (see below), `POLL_MS=5000`.

- `chain.ts` — viem `createPublicClient`/`createWalletClient` (Base Sepolia); subscribe to `IntentCreated`; fetch OPEN intents on boot.
- `hlfeed.ts`:
  - Price feed: `POST https://api.hyperliquid.xyz/info` body `{"type":"l2Book","coin":"<market>"}` → `levels[0]` = bids, `levels[1]` = asks; `mid = (bestBid.px + bestAsk.px)/2` as float → convert to 1e6 int. **Do not use `allMids` — it does not return HIP-3 markets.**
  - Verified live markets on testnet: 70 `xyz:*` markets (incl. `xyz:GOLD`, `xyz:CL`, `xyz:NVDA`); mainnet `xyz:CL` book is liquid (use mainnet feed for triggers, testnet for execution).
- `triggers.ts` — each poll, for each OPEN intent: `fired = triggerAbove ? mid >= triggerPrice : mid <= triggerPrice`. On fire: bound-check against `referencePrice`/`maxDeviationBps` using the *observed mid*; if violated, log `BOUND_EXCEEDED` and mark intent skipped (do not retry).
- `executor.ts` — Hyperliquid **testnet** `POST https://api.hyperliquid-testnet.xyz/exchange`:
  - Action: `{"type":"order","orders":[{"a":<assetId>,"b":<isBuy>,"p":<px>,"s":<sz>,"r":false,"t":{"limit":{"tif":"Gtc"}}}],"grouping":"na"}` with EIP-712 signature per Hyperliquid's signing spec (use their documented action hashing; test against testnet).
  - **Resolve `<assetId>` at runtime** from `POST {testnet}/info {"type":"meta","dex":"xyz"}` universe ordering — do not hardcode (HIP-3 ids follow `100000 + dex_index*10000 + market_index`; confirm dex_index from the response).
  - Size `s` is in base-asset units respecting `szDecimals` from meta. For the demo the solver quotes both sides on thin books (testnet `xyz:CL` book is empty; `xyz:GOLD` has a small book) — i.e., the solver acts as market maker + taker. Disclose in README.
  - Return actual fill price → call `fillIntent(id, entryPrice)` on Base.
  - Testnet wallet funding: Hyperliquid testnet faucet (first-day task; verify it works before building further).
- `settler.ts` — on expiry or close signal: close HL position (reduce-only limit/market), capture exit px, call `settleIntent(id, exitPrice)`.
- `verify.ts` — at each fill/settle, persist `{intentId, timestamp, reportedPx, bookSnapshot(top 5 levels), explorerUrl}` to a JSON served by the frontend.

## 3. Frontend (Vite + wagmi, Base Sepolia)

- `/` Create: market select (from `hlfeed` market list), side toggle, size input, trigger price + above/below toggle, reference price (auto = current mid, editable), max deviation bps (default 500), expiry presets (e.g. "Mon 9:30am ET"), fee preview, worst-case fill, max loss. Two txs: USDC approve + `createIntent` (EIP-712 sign in-wallet).
- `/intents` My intents: status pipeline OPEN → FILLED → SETTLED; each row expandable to the Verify panel (reported px vs book snapshot vs explorer link).
- Reads: contract view fns / events; writes via wagmi.

## 4. Testing checklist
- [ ] Foundry: create/cancel/fill/settle happy paths; bound revert; payout-nonnegative invariant; expiry refund; replay protection (same intent twice reverts).
- [ ] Fork test (Base Sepolia fork): full loop with real USDC.
- [ ] Solver dry-run: trigger eval against mainnet feed without placing orders.
- [ ] End-to-end on testnets: intent → trigger → testnet fill → settlement; verify panel data correct.
- [ ] Demo rehearsal with scripted weekend gap (disclosed as simulation).

## 5. Build order (matches 7-day plan)
1. Contract + tests + Base Sepolia deploy; fund HL testnet wallet (faucet) — **unblocks everything**.
2. `hlfeed` + `triggers` (no trading yet).
3. `executor` (testnet order placement; resolve asset ids).
4. `settler` + contract settlement; full loop test.
5. Frontend.
6. Demo rehearsal + video + README (trust model, simulation disclosure).

## 6. Known gotchas
- `allMids` doesn't serve HIP-3 — poll `l2Book` per market.
- Testnet books are thin/empty — solver must quote both sides for the demo.
- HL exchange signing is EIP-712 with Hyperliquid-specific typehashes — use their docs/reference SDK, don't hand-roll.
- Price decimal normalization: HL `px` strings → 1e6 ints at every boundary; fuzz-test the conversion.
- USDC on Base Sepolia: verify the canonical testnet address at deploy time, don't trust memory.
