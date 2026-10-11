import type { Intent } from "./types";
import { orderToWire, orderWireToAction, signL1Action, getTimestampMs } from "hyperliquid";
import { Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Hyperliquid testnet. HL_TESTNET_KEY should be the solver's L1 private key.
// Falls back to OPERATOR_KEY (the Base solver key) if not set separately.
const HL_KEY = (process.env.HL_TESTNET_KEY || process.env.OPERATOR_KEY) as `0x${string}` | undefined;
// Execution meta + order placement. Deliberately separate from the price-feed
// URL (HL_INFO_URL, mainnet): triggers watch real mainnet RWA prices, but
// orders are placed on testnet. Sharing one var caused mainnet/testnet index
// mismatches (HIP-3 global asset indices are per-network).
const HL_EXEC_INFO = process.env.HL_EXEC_INFO_URL || "https://api.hyperliquid-testnet.xyz/info";
const HL_EXCHANGE = HL_EXEC_INFO.replace(/\/info$/, "/exchange");
// This executor targets testnet. Flip HL_EXEC_INFO_URL and this flag together for mainnet.
const IS_MAINNET = false;

let wallet: Wallet | null = null;

function getWallet(): Wallet {
    if (!wallet) {
        if (!HL_KEY) throw new Error("Missing HL_TESTNET_KEY / OPERATOR_KEY");
        wallet = new Wallet(HL_KEY);
    }
    return wallet;
}

interface AssetMeta {
    name: string;
    szDecimals: number;
}

let assetCache: Record<string, AssetMeta> | null = null;

export async function loadAssetMeta(): Promise<Record<string, AssetMeta>> {
    if (assetCache) return assetCache;

    // HIP-3 universe for the xyz dex via raw info API
    const response = await fetch(HL_EXEC_INFO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "meta", dex: "xyz" }),
    });
    if (!response.ok) throw new Error("Failed to load universe meta");
    const data: any = await response.json();
    const universe = data?.universe || [];

    const cache: Record<string, AssetMeta> = {};
    for (const asset of universe) {
        cache[asset.name] = { name: asset.name, szDecimals: asset.szDecimals };
    }
    assetCache = cache;
    return cache;
}

/**
 * Resolve the global numeric asset index for a HIP-3 market like "xyz:CL".
 *
 * The wire protocol addresses HIP-3 assets by global index:
 *   globalIndex = 100000 + dexPosition * 10000 + universeIndex
 * where dexPosition is the dex's raw position in the `perpDexs` list
 * (position 0 is the null main-dex entry) and universeIndex is the asset's
 * position in the dex's `meta` universe. Resolved dynamically because dexes
 * can be added at any time, shifting positions.
 */
const dexPositionCache: Record<string, number> = {};
const assetIndexCache: Record<string, number> = {};

export async function resolveAssetIndex(market: string): Promise<number> {
    if (assetIndexCache[market] !== undefined) return assetIndexCache[market];

    const sep = market.indexOf(":");
    if (sep < 0) throw new Error(`Market ${market} is not a dex-prefixed HIP-3 market`);
    const dex = market.slice(0, sep);

    if (dexPositionCache[dex] === undefined) {
        const res = await fetch(HL_EXEC_INFO, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "perpDexs" }),
        });
        if (!res.ok) throw new Error("Failed to load perpDexs");
        const dexes: any[] = await res.json();
        const pos = dexes.findIndex((d) => d && d.name === dex);
        if (pos < 0) throw new Error(`Dex ${dex} not found in perpDexs`);
        dexPositionCache[dex] = pos;
    }

    const metaRes = await fetch(HL_EXEC_INFO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "meta", dex }),
    });
    if (!metaRes.ok) throw new Error(`Failed to load meta for dex ${dex}`);
    const meta: any = await metaRes.json();
    const universe: any[] = meta?.universe || [];
    const idx = universe.findIndex((a) => a.name === market);
    if (idx < 0) throw new Error(`Market ${market} not found in ${dex} universe`);

    const globalIndex = 100000 + dexPositionCache[dex] * 10000 + idx;
    assetIndexCache[market] = globalIndex;
    return globalIndex;
}

/** POST a signed L1 action to the exchange endpoint. */
async function postL1Action(action: any): Promise<any> {
    const nonce = getTimestampMs();
    const signature = await signL1Action(getWallet(), action, null, nonce, IS_MAINNET);
    const res = await fetch(HL_EXCHANGE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
    });
    if (!res.ok) throw new Error(`Exchange POST failed: ${res.status}`);
    return res.json();
}

const leverageSetCache: Record<number, boolean> = {};

/**
 * HIP-3 markets are isolated-margin only. Ensure isolated leverage is set
 * before ordering (idempotent per asset; cached).
 */
async function ensureIsolatedLeverage(asset: number, leverage = 5): Promise<void> {
    if (leverageSetCache[asset]) return;
    const result: any = await postL1Action({
        type: "updateLeverage",
        asset,
        isCross: false,
        leverage,
    });
    if (result?.status !== "ok") {
        throw new Error(`updateLeverage failed: ${JSON.stringify(result).slice(0, 200)}`);
    }
    leverageSetCache[asset] = true;
}

/**
 * Places a real IOC order on Hyperliquid testnet for a triggered intent.
 * Returns the actual average fill price in 1e6, or null if the order did not fill.
 *
 * NOTE: the `hyperliquid` SDK's high-level placeOrder only resolves native-dex
 * assets ("BTC"), so HIP-3 markets are placed via the raw wire path: the
 * market name is resolved to its global asset index and the order is signed
 * with the SDK's exported primitives.
 */
export async function executeOrder(intent: Intent, fillPx1e6: bigint): Promise<bigint | null> {
    const metaMap = await loadAssetMeta();
    const assetMeta = metaMap[intent.market];
    if (!assetMeta) {
        console.error(`[executor] Asset meta not found for ${intent.market}`);
        return null;
    }

    const asset = await resolveAssetIndex(intent.market);
    await ensureIsolatedLeverage(asset);

    // Size in base-asset units, respecting szDecimals
    const pxFloat = Number(fillPx1e6) / 1e6;
    const sizeFloat = Number(intent.sizeUsd) / 1e6 / pxFloat;
    const szStr = sizeFloat.toFixed(assetMeta.szDecimals);
    // Price: round to the asset's tick size (use 2 decimals for xyz RWA markets)
    const pxStr = pxFloat.toFixed(2);

    console.log(`[executor] Placing ${intent.isLong ? "BUY" : "SELL"} ${szStr} ${intent.market} (asset ${asset}) @ ${pxStr} (IOC)`);

    const wire = orderToWire(
        {
            coin: intent.market,
            is_buy: intent.isLong,
            sz: szStr,
            limit_px: pxStr,
            order_type: { limit: { tif: "Ioc" } },
            reduce_only: false,
        } as any,
        asset,
    );
    const action = orderWireToAction([wire]);
    const result: any = await postL1Action(action);

    console.log(`[executor] Order response:`, JSON.stringify(result).slice(0, 500));

    // Extract fill price from the response
    const statuses = result?.response?.data?.statuses || [];
    let totalSz = 0;
    let totalValue = 0;
    for (const s of statuses) {
        if (s.filled) {
            const fSz = parseFloat(s.filled.totalSz);
            const fPx = parseFloat(s.filled.avgPx);
            totalSz += fSz;
            totalValue += fSz * fPx;
        }
    }

    if (totalSz === 0) {
        console.error(`[executor] Order did not fill. Statuses:`, JSON.stringify(statuses).slice(0, 300));
        return null;
    }

    const avgPx = totalValue / totalSz;
    const avgPx1e6 = BigInt(Math.round(avgPx * 1e6));
    console.log(`[executor] Filled ${totalSz} @ avg ${avgPx} (${avgPx1e6})`);
    return avgPx1e6;
}

/**
 * Places a resting GTC order on the Hyperliquid testnet. Demo utility:
 * the xyz:CL testnet book is empty, so IOC orders cannot fill during a
 * recording — seed the book first with the solver's own resting orders,
 * then run the real intent flow and let the IOC fill against them.
 * Same raw-wire path as executeOrder (SDK placeOrder can't resolve HIP-3).
 */
export async function restGtcOrder(market: string, isBuy: boolean, sz: string, px: string): Promise<string> {
    const asset = await resolveAssetIndex(market);
    await ensureIsolatedLeverage(asset);
    const wire = orderToWire(
        {
            coin: market,
            is_buy: isBuy,
            sz,
            limit_px: px,
            order_type: { limit: { tif: "Gtc" } },
            reduce_only: false,
        } as any,
        asset,
    );
    const action = orderWireToAction([wire]);
    const result: any = await postL1Action(action);
    console.log(`[executor] GTC ${isBuy ? "BUY" : "SELL"} ${sz} ${market} @ ${px}:`, JSON.stringify(result).slice(0, 500));
    return JSON.stringify(result);
}
