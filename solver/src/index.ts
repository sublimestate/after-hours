import { fetchL2BookMid } from "./hlfeed";
import { evaluateTrigger, TriggerResult } from "./triggers";
import { executeOrder, closePosition } from "./executor";
import { submitFillOnChain, submitSettleOnChain } from "./settler";
import { recordEvent } from "./verify";
import { fetchOpenIntents, publicClient, escrowContract, ESCROW_ADDRESS, escrowAbi } from "./chain";
import type { Intent } from "./types";
import dotenv from "dotenv";

dotenv.config();

const openIntents = new Map<string, Intent>();
const POLL_MS = parseInt(process.env.POLL_MS || "5000");
// Delay between fill confirmation and auto-settle (ms). Gives the demo
// a beat to show FILLED before SETTLED; 0 = settle immediately.
const SETTLE_DELAY_MS = parseInt(process.env.SETTLE_DELAY_MS || "15000");

function toIntent(id: string, c: {
    user: string; market: string; isLong: boolean; sizeUsd: bigint; deposit: bigint;
    triggerPrice: bigint; triggerAbove: boolean; referencePrice: bigint;
    maxDeviationBps: bigint; expiry: number; solverFeeBps: bigint; nonce: bigint;
}): Intent {
    return { id, ...c };
}

/**
 * Settle a filled intent: close the HL position, then submit settleIntent
 * with the actual close price. Runs after FILL is confirmed on-chain.
 */
async function settleFilledIntent(intent: Intent, bookSnapshot: any) {
    try {
        console.log(`[bot] Settling ${intent.id}...`);

        const exitPrice = await closePosition(intent);
        if (!exitPrice) {
            console.error(`[bot] Could not close HL position for ${intent.id}; will retry next cycle`);
            // Re-queue for retry
            pendingSettle.set(intent.id, { intent, bookSnapshot });
            return;
        }

        recordEvent(intent.id, "SETTLE", exitPrice, bookSnapshot);
        const settleHash = await submitSettleOnChain(intent.id, exitPrice);
        if (!settleHash) {
            console.error(`[bot] Settle tx failed for ${intent.id}; will retry next cycle`);
            pendingSettle.set(intent.id, { intent, bookSnapshot });
            return;
        }

        pendingSettle.delete(intent.id);
        console.log(`[bot] Intent ${intent.id} SETTLED: ${settleHash}`);
    } catch (err) {
        console.error(`[bot] Settle failed for ${intent.id}, will retry:`, (err as Error).message);
        pendingSettle.set(intent.id, { intent, bookSnapshot });
    }
}

// Intents filled on-chain but not yet settled (HL position still open)
const pendingSettle = new Map<string, { intent: Intent; bookSnapshot: any }>();

async function pollMarkets() {
    try {
        console.log(`[bot] Polling ${openIntents.size} open intents, ${pendingSettle.size} pending settle...`);

        // Retry any fills that confirmed but haven't settled yet
        for (const { intent, bookSnapshot } of [...pendingSettle.values()]) {
            await settleFilledIntent(intent, bookSnapshot);
        }

        const marketsToPoll = [...new Set([...openIntents.values()].map(i => i.market))];

        for (const market of marketsToPoll) {
            let bookSnapshot;
            try {
                bookSnapshot = await fetchL2BookMid(market);
            } catch (err) {
                console.error(`[bot] Price feed error for ${market}:`, (err as Error).message);
                continue;
            }
            if (!bookSnapshot) continue;

            for (const intent of [...openIntents.values()].filter(i => i.market === market)) {
                try {
                    await processIntent(intent, bookSnapshot);
                } catch (err) {
                    console.error(`[bot] Error processing ${intent.id}:`, (err as Error).message);
                    // Intent stays in the map; retried next poll
                }
            }
        }
    } catch (err) {
        console.error(`[bot] Poll cycle failed:`, (err as Error).message);
    }
}

async function processIntent(intent: Intent, bookSnapshot: any) {
    // Skip expired intents (anyone can call expireUnfilled; the bot doesn't need to)
    if (Date.now() / 1000 >= intent.expiry) {
        openIntents.delete(intent.id);
        return;
    }

    const result = evaluateTrigger(intent, bookSnapshot);

    if (result === TriggerResult.READY_TO_FILL) {
        console.log(`[bot] Trigger READY for ${intent.id}. Executing...`);

        const fillPrice = await executeOrder(intent, bookSnapshot.midPrice1e6);
        if (!fillPrice) {
            console.error(`[bot] HL order did not fill for ${intent.id}; retrying next poll`);
            return;
        }

        // Submit fill and WAIT for confirmation before recording/removing
        const fillHash = await submitFillOnChain(intent, fillPrice);
        if (!fillHash) {
            console.error(`[bot] On-chain fill failed for ${intent.id}; HL position open, will retry`);
            // NOTE: HL position is open but fill not confirmed. On retry,
            // executeOrder will open ANOTHER position. For the demo this is
            // acceptable; production needs idempotency (see README).
            return;
        }

        // Fill confirmed — record, remove from open, queue for settle
        recordEvent(intent.id, "FILL", fillPrice, bookSnapshot);
        openIntents.delete(intent.id);
        console.log(`[bot] Intent ${intent.id} FILLED: ${fillHash}`);

        // Auto-settle after a short delay (demo beat)
        const snapshot = bookSnapshot;
        pendingSettle.set(intent.id, { intent, bookSnapshot: snapshot });
        setTimeout(() => {
            const pending = pendingSettle.get(intent.id);
            if (pending) settleFilledIntent(pending.intent, pending.bookSnapshot);
        }, SETTLE_DELAY_MS);
    } else if (result === TriggerResult.BOUND_EXCEEDED) {
        console.log(`[bot] Intent ${intent.id} exceeded bounds; dropping (contract would revert).`);
        openIntents.delete(intent.id);
    }
}

async function startBot() {
    console.log("[bot] Starting AfterHours Solver Bot...");

    // Boot: load all OPEN intents from chain
    const existing = await fetchOpenIntents();
    for (const c of existing) {
        openIntents.set(c.id, toIntent(c.id, c));
    }
    console.log(`[bot] Loaded ${openIntents.size} open intents from chain.`);

    // Live: subscribe to new intents
    publicClient.watchContractEvent({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        eventName: "IntentCreated",
        onLogs: (logs: any[]) => {
            for (const log of logs) {
                const id = log.args.id as string;
                const i = log.args.intent as any;
                if (!openIntents.has(id)) {
                    openIntents.set(id, toIntent(id, {
                        user: i.user,
                        market: i.market,
                        isLong: i.isLong,
                        sizeUsd: i.sizeUsd,
                        deposit: i.deposit,
                        triggerPrice: i.triggerPrice,
                        triggerAbove: i.triggerAbove,
                        referencePrice: i.referencePrice,
                        maxDeviationBps: i.maxDeviationBps,
                        expiry: Number(i.expiry),
                        solverFeeBps: i.solverFeeBps,
                        nonce: i.nonce,
                    }));
                    console.log(`[bot] New intent ${id} (${i.market})`);
                }
            }
        },
    });

    setInterval(pollMarkets, POLL_MS);
}

startBot().catch(console.error);
