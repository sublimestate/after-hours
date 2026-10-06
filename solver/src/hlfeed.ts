import dotenv from "dotenv";
dotenv.config();

const HL_INFO_URL = process.env.HL_INFO_URL || "https://api.hyperliquid.xyz/info";

export interface BookSnapshot {
    coin: string;
    timestamp: number;
    midPrice1e6: bigint;
    bids: { px: string; sz: string; n: number }[];
    asks: { px: string; sz: string; n: number }[];
}

/**
 * Fetches the l2Book for a given market (e.g. "xyz:GOLD") from Hyperliquid.
 * Uses l2Book instead of allMids because allMids does not return HIP-3 markets.
 */
export async function fetchL2BookMid(coin: string): Promise<BookSnapshot | null> {
    try {
        const response = await fetch(HL_INFO_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "l2Book", coin })
        });

        if (!response.ok) {
            console.error(`[hlfeed] Failed to fetch book for ${coin}: ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        
        const bids = data.levels[0] || [];
        const asks = data.levels[1] || [];

        if (bids.length === 0 || asks.length === 0) {
            console.warn(`[hlfeed] Orderbook empty for ${coin}`);
            return null;
        }

        const bestBid = parseFloat(bids[0].px);
        const bestAsk = parseFloat(asks[0].px);
        const mid = (bestBid + bestAsk) / 2;

        // Convert mid float to 1e6 integer format
        const midPrice1e6 = BigInt(Math.floor(mid * 1e6));

        return {
            coin,
            timestamp: data.time,
            midPrice1e6,
            bids: bids.slice(0, 5), // Keep top 5 levels for the verify panel
            asks: asks.slice(0, 5)
        };
    } catch (error) {
        console.error(`[hlfeed] Error fetching book for ${coin}:`, error);
        return null;
    }
}
