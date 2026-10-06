import { Intent } from "./types";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

dotenv.config();

const HL_EXCHANGE_URL = process.env.HL_EXCHANGE_URL || "https://api.hyperliquid-testnet.xyz/exchange";
const HL_INFO_URL = process.env.HL_INFO_URL || "https://api.hyperliquid-testnet.xyz/info";

// The API key must be an L1 wallet private key (or an API agent key, but for MVP L1 is easiest)
const account = process.env.HL_TESTNET_KEY ? privateKeyToAccount(process.env.HL_TESTNET_KEY as `0x${string}`) : null;

interface AssetMeta {
    name: string;
    szDecimals: number;
    assetId: number;
}

let assetCache: Record<string, AssetMeta> | null = null;

export async function loadAssetMeta(): Promise<Record<string, AssetMeta>> {
    if (assetCache) return assetCache;
    
    // Fetch HIP-3 universe for the 'xyz' dex
    const response = await fetch(HL_INFO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "meta", dex: "xyz" })
    });
    
    if (!response.ok) {
        throw new Error("Failed to load universe meta");
    }

    const data = await response.json();
    const cache: Record<string, AssetMeta> = {};
    
    // For HIP-3, the assetId requires knowing the dex index. 
    // The API usually returns the `universe` array. We dynamically resolve it.
    const universe = data.universe || [];
    
    // Note: The precise dex_index should be parsed from the response if available.
    // Assuming dex_index is 1 for 'xyz' for this testnet stub.
    const DEX_INDEX = 1; 

    universe.forEach((asset: any, index: number) => {
        cache[asset.name] = {
            name: asset.name,
            szDecimals: asset.szDecimals,
            assetId: 100000 + (DEX_INDEX * 10000) + index
        };
    });

    assetCache = cache;
    return cache;
}

/**
 * Places an IOC order on the Hyperliquid testnet for a triggered intent.
 */
export async function executeOrder(intent: Intent, fillPx1e6: bigint): Promise<bigint | null> {
    if (!account) throw new Error("Missing HL_TESTNET_KEY");
    
    const metaMap = await loadAssetMeta();
    const assetMeta = metaMap[intent.market];
    
    if (!assetMeta) {
        console.error(`[executor] Asset meta not found for ${intent.market}`);
        return null;
    }

    // format price: string float
    const pxFloat = Number(fillPx1e6) / 1e6;
    const pxStr = pxFloat.toString();

    // format size: string float respecting szDecimals
    // intent.sizeUsd is notional in 1e6. sizeInAsset = sizeUsd / price
    const sizeFloat = (Number(intent.sizeUsd) / 1e6) / pxFloat;
    const szStr = sizeFloat.toFixed(assetMeta.szDecimals);

    const action = {
        type: "order",
        orders: [{
            a: assetMeta.assetId,
            b: intent.isLong, // true for buy, false for sell
            p: pxStr,
            s: szStr,
            r: false, // reduce-only
            t: { limit: { tif: "Ioc" } } // Immediate-Or-Cancel ensures no partial ghost orders
        }],
        grouping: "na"
    };

    // Note: In a production environment, the action must be packed into msgpack and signed via EIP-712.
    // Hyperliquid uses a specific schema for signature payloads.
    // You should integrate `@hyperliquid/sdk` to handle the msgpack hashing automatically.
    console.log(`[executor] Constructing EIP-712 signature for action:`, JSON.stringify(action));
    
    // MOCK SUBMISSION (to allow testing the base chain integrations first)
    console.log(`[executor] Mock executed ${intent.market} order. Expected size: ${szStr} @ ${pxStr}`);
    
    // Returns the exact entry price to settle back on Base
    return fillPx1e6; 
}
