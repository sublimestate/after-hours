import { fetchL2BookMid } from "./hlfeed";
import { evaluateTrigger, TriggerResult } from "./triggers";
import { executeOrder } from "./executor";
import { submitFillOnChain } from "./settler";
import { recordEvent } from "./verify";
import { fetchOpenIntents, publicClient, escrowContract, ESCROW_ADDRESS, escrowAbi } from "./chain";
import type { Intent } from "./types";
import dotenv from "dotenv";

dotenv.config();

const openIntents = new Map<string, Intent>();
const POLL_MS = parseInt(process.env.POLL_MS || "5000");

function toIntent(id: string, c: {
    user: string; market: string; isLong: boolean; sizeUsd: bigint; deposit: bigint;
    triggerPrice: bigint; triggerAbove: boolean; referencePrice: bigint;
    maxDeviationBps: bigint; expiry: number; solverFeeBps: bigint; nonce: bigint;
}): Intent {
    return { id, ...c };
}

async function pollMarkets() {
    console.log(`[bot] Polling ${openIntents.size} open intents...`);

    const marketsToPoll = [...new Set([...openIntents.values()].map(i => i.market))];

    for (const market of marketsToPoll) {
        const bookSnapshot = await fetchL2BookMid(market);
        if (!bookSnapshot) continue;

        for (const intent of [...openIntents.values()].filter(i => i.market === market)) {
            // Skip expired intents (anyone can call expireUnfilled; the bot doesn't need to)
            if (Date.now() / 1000 >= intent.expiry) {
                openIntents.delete(intent.id);
                continue;
            }

            const result = evaluateTrigger(intent, bookSnapshot);

            if (result === TriggerResult.READY_TO_FILL) {
                console.log(`[bot] Trigger READY for ${intent.id}. Executing...`);

                const fillPrice = await executeOrder(intent, bookSnapshot.midPrice1e6);

                if (fillPrice) {
                    // Record the fill for the verify panel before submitting on-chain
                    recordEvent(intent.id, "FILL", fillPrice, bookSnapshot);
                    await submitFillOnChain(intent, fillPrice);
                    openIntents.delete(intent.id);
                }
            } else if (result === TriggerResult.BOUND_EXCEEDED) {
                console.log(`[bot] Intent ${intent.id} exceeded bounds; dropping (contract would revert).`);
                openIntents.delete(intent.id);
            }
        }
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
