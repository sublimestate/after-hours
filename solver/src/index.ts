import { fetchL2BookMid } from "./hlfeed";
import { evaluateTrigger, TriggerResult } from "./triggers";
import { executeOrder } from "./executor";
import { submitFillOnChain } from "./settler";
import { Intent } from "./types";
import dotenv from "dotenv";

dotenv.config();

// MOCK In-memory store for intents
// In a real implementation, you'd fetch OPEN intents from `chain.ts` on boot,
// and listen to `IntentCreated` events.
const openIntents: Intent[] = [];
const POLL_MS = parseInt(process.env.POLL_MS || "5000");

async function pollMarkets() {
    console.log(`[bot] Polling ${openIntents.length} open intents...`);

    // Group intents by market to minimize API calls
    const marketsToPoll = [...new Set(openIntents.map(i => i.market))];

    for (const market of marketsToPoll) {
        const bookSnapshot = await fetchL2BookMid(market);
        if (!bookSnapshot) continue;

        const intentsForMarket = openIntents.filter(i => i.market === market);

        for (const intent of intentsForMarket) {
            const result = evaluateTrigger(intent, bookSnapshot);
            
            if (result === TriggerResult.READY_TO_FILL) {
                console.log(`[bot] Trigger READY for ${intent.id}. Executing...`);
                
                // 1. Execute on Hyperliquid Testnet
                const fillPrice = await executeOrder(intent, bookSnapshot.midPrice1e6);
                
                if (fillPrice) {
                    // 2. Submit fill to Base Sepolia Escrow
                    await submitFillOnChain(intent, fillPrice);
                    
                    // Remove from open list
                    const idx = openIntents.indexOf(intent);
                    if (idx > -1) openIntents.splice(idx, 1);
                }
            } else if (result === TriggerResult.BOUND_EXCEEDED) {
                // If it exceeded bounds, we drop it to avoid wasting gas on reverts
                console.log(`[bot] Dropping intent ${intent.id} due to bound violation.`);
                const idx = openIntents.indexOf(intent);
                if (idx > -1) openIntents.splice(idx, 1);
            }
        }
    }
}

async function startBot() {
    console.log("[bot] Starting AfterHours Solver Bot...");
    // Initial fetch of OPEN intents from contract would go here...
    
    setInterval(pollMarkets, POLL_MS);
}

startBot().catch(console.error);
