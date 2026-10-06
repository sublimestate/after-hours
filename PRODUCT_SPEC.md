# AfterHours — Product Spec
*(working title; owner to confirm)*

## One-liner
Trade Hyperliquid's 24/7 RWA perps from Base — no bridging, no Hyperliquid account.

## Problem
When news breaks outside TradFi hours, prices move immediately on Hyperliquid's RWA perpetuals (equities, gold, crude). A trader whose capital sits on Base or Tempo can't react: bridging takes too long, and by the time funds arrive the move is gone. Hyperliquid's CLOB only serves users who already have collateral there.

## Solution
Conditional intents. The user locks USDC in an escrow contract on their native chain and signs an order like: *"Long $500 of xyz:GOLD if it trades 3% above Friday's close, never pay more than 5% over, expires Monday 9:30am ET."* A solver network monitors these intents; when a trigger fires, a solver opens the position on Hyperliquid's HIP-3 RWA market with its own capital and the P&L settles back to the user on their native chain. Fills are bound-aware: the intent refuses to execute beyond a max deviation from the reference price, protecting against illiquid weekend prints.

## Target user
Crypto-native traders who hold capital on L2s (Base/Tempo) and want event-driven exposure to real-world assets without managing a Hyperliquid account or bridging under time pressure.

## User stories
1. As a trader, I want to pre-commit to a trade that only fires if a price event happens, so I don't have to watch charts overnight.
2. As a trader, I want my funds to stay on my native chain, so I never bridge under time pressure.
3. As a trader, I want protection against bad fills when books are thin, so my trigger can't execute into a manipulated print.
4. As a skeptic, I want to verify every fill price against Hyperliquid's public data, so I don't have to trust the solver blindly.

## Core flows
1. **Create intent** — connect wallet → pick market (xyz:GOLD, xyz:CL, xyz:NVDA…) → side, size (USD), trigger price + direction (above/below), reference price (auto-filled from current mid), max deviation (default 5%), expiry preset → review fee → sign (EIP-712) + approve/deposit USDC → intent is OPEN.
2. **Trigger & fill** — solver detects the trigger, checks the deviation bound, executes on Hyperliquid, records entry price on-chain → intent is FILLED. User sees entry price + link to Hyperliquid explorer.
3. **Settle** — at expiry (or on user close request) the solver closes the Hyperliquid position and settles on-chain → intent is SETTLED. User receives deposit ± PnL − solver fee.
4. **Cancel** — user cancels an OPEN intent anytime before fill → full refund.
5. **Expire** — unfilled intent past expiry → anyone can trigger refund.
6. **Verify** — per intent, a panel shows reported entry/exit prices next to Hyperliquid's public order-book snapshot at that timestamp.

## Screens (MVP)
1. **Create** — the intent form described above. Must show: estimated solver fee, worst-case fill (reference × (1 + max deviation)), and max loss (= deposit).
2. **My intents** — table/cards with status pipeline OPEN → FILLED → SETTLED, each showing market, side, size, trigger, entry/exit, PnL.
3. **Verify** — per-intent expandable panel with price cross-checks and explorer links.

## Demo script (hackathon video, ~3 min)
1. (15s) Friday-close mid for xyz:GOLD shown from the live Hyperliquid book; narrator frames the weekend-news problem.
2. (30s) Create intent on Base Sepolia: long $500, trigger +3% above Friday close, 5% max deviation, expires Monday 9:30am ET. Sign + deposit, tx confirmed.
3. (30s) Simulated weekend price gap on testnet (disclosed as simulation); trigger fires; solver fills on Hyperliquid testnet — show the fill tx + explorer link.
4. (20s, optional) Second intent with trigger beyond the deviation bound → solver refuses, "protected" state shown. This is the differentiator moment.
5. (30s) Price moves; solver closes and settles; user receives deposit + PnL − fee on Base Sepolia.
6. (20s) Verify panel: every price cross-checked against public Hyperliquid data.
7. (15s) Close: what it is, track fit (HyperCore execution + Base origination/settlement), what's next (solver staking/slashing).

## Out of scope (v2)
- Permissionless solver network with staking/slashing (demo: single trusted operator).
- News-API event triggers (v1: price triggers only).
- Leverage > 1x.
- Tempo origination (Base alone suffices for the demo).

## Success criteria
- Full loop on testnets: signed intent → trigger → real Hyperliquid testnet fill → on-chain settlement, all links verifiable.
- Demo video under 3 minutes following the script above.
- README documents the trust model honestly (operator-run solver for the demo; fills verifiable post-hoc).
