import type { BookSnapshot } from "./hlfeed";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function dataDir(): string {
    return process.env.VERIFY_DATA_DIR || path.join(__dirname, "..", "data");
}

function recordsFile(): string {
    return path.join(dataDir(), "verify-records.json");
}

export interface VerifyRecord {
    intentId: string;
    event: "FILL" | "SETTLE";
    timestamp: number;
    reportedPx1e6: string; // bigint as string for JSON
    // Book snapshot at event time (top 5 levels, from hlfeed)
    bookSnapshot: {
        coin: string;
        midPrice1e6: string;
        bids: { px: string; sz: string }[];
        asks: { px: string; sz: string }[];
    };
    // Link to the Hyperliquid explorer for independent verification
    explorerUrl: string;
}

function hlExplorerUrl(coin: string): string {
    // Hyperliquid testnet explorer; strip the dex prefix for the URL
    const base = coin.includes(":") ? coin.split(":")[1] : coin;
    return `https://app.hyperliquid-testnet.xyz/trade/${base}`;
}

function loadRecords(): VerifyRecord[] {
    try {
        if (fs.existsSync(recordsFile())) {
            return JSON.parse(fs.readFileSync(recordsFile(), "utf-8"));
        }
    } catch (e) {
        console.error("[verify] Failed to load records:", e);
    }
    return [];
}

function saveRecords(records: VerifyRecord[]) {
    try {
        fs.mkdirSync(dataDir(), { recursive: true });
        fs.writeFileSync(recordsFile(), JSON.stringify(records, null, 2));
    } catch (e) {
        console.error("[verify] Failed to save records:", e);
    }
}

/**
 * Persists a fill/settle event with the reported price and the order-book
 * snapshot at that moment, so the frontend's verify panel can cross-check
 * the solver's reported price against public Hyperliquid data.
 */
export function recordEvent(
    intentId: string,
    event: "FILL" | "SETTLE",
    reportedPx1e6: bigint,
    snapshot: BookSnapshot
): VerifyRecord {
    const record: VerifyRecord = {
        intentId,
        event,
        timestamp: Date.now(),
        reportedPx1e6: reportedPx1e6.toString(),
        bookSnapshot: {
            coin: snapshot.coin,
            midPrice1e6: snapshot.midPrice1e6.toString(),
            bids: snapshot.bids.map(b => ({ px: b.px, sz: b.sz })),
            asks: snapshot.asks.map(a => ({ px: a.px, sz: a.sz })),
        },
        explorerUrl: hlExplorerUrl(snapshot.coin),
    };

    const records = loadRecords();
    records.push(record);
    saveRecords(records);

    console.log(`[verify] Recorded ${event} for ${intentId} at ${reportedPx1e6}`);
    return record;
}

/**
 * Returns all verify records, optionally filtered by intent.
 * The frontend serves these to the verify panel.
 */
export function getRecords(intentId?: string): VerifyRecord[] {
    const records = loadRecords();
    return intentId ? records.filter(r => r.intentId === intentId) : records;
}
