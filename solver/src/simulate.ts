import { walletClient, publicClient, escrowContract, ESCROW_ADDRESS, account } from "./chain";
import { fetchL2BookMid } from "./hlfeed";
import type { Intent } from "./types";
import { keccak256, encodePacked, encodeAbiParameters, parseAbiParameters, pad } from "viem";

async function simulate() {
    console.log("=== AfterHours Testnet Simulation ===");
    
    if (!account) {
        console.error("Please set OPERATOR_KEY in .env");
        return;
    }

    console.log(`Using account: ${account.address}`);
    
    // 1. Fetch current price of xyz:GOLD
    const market = "xyz:GOLD";
    const book = await fetchL2BookMid(market);
    if (!book) {
        console.error("Could not fetch orderbook");
        return;
    }

    const midPrice = book.midPrice1e6;
    console.log(`Current ${market} Mid Price: ${Number(midPrice) / 1e6}`);

    // 2. Create a mock Intent structure
    // We set the trigger price 1% below current mid (so it triggers immediately if we want triggerAbove = false)
    // Or we set triggerAbove = true and triggerPrice 1% below current mid to simulate an already fired intent.
    const intent: Intent = {
        id: "0x00", // Will calculate later
        user: account.address, // For simulation, solver is also user
        market: market,
        isLong: true,
        sizeUsd: 10n * 1000000n, // $10
        deposit: 12n * 1000000n, // $12
        triggerPrice: midPrice - (midPrice * 100n / 10000n), // 1% below mid
        triggerAbove: true, // Will instantly trigger
        referencePrice: midPrice,
        maxDeviationBps: 500n, // 5%
        expiry: BigInt(Math.floor(Date.now() / 1000) + 86400) as unknown as number, // 1 day
        solverFeeBps: 50n,
        nonce: BigInt(Date.now()) as unknown as bigint
    };

    console.log(`Intent configured. Trigger: ${Number(intent.triggerPrice)/1e6}, Expiry: ${intent.expiry}`);
    
    // Note: To fully test on-chain, we would need to sign this Intent via EIP-712 and call createIntent.
    // For this simulation script, we just demonstrate the solver loop.
    
    // 3. Evaluate Trigger
    import("./triggers").then(({ evaluateTrigger, TriggerResult }) => {
        const result = evaluateTrigger(intent, book);
        console.log(`Trigger Result: ${TriggerResult[result]}`);
        
        if (result === TriggerResult.READY_TO_FILL) {
            console.log("Simulation successful! Intent is ready to be filled.");
            console.log("Next steps:");
            console.log("1. Deploy RwaIntentEscrow to Base Sepolia");
            console.log("2. Create this intent on-chain");
            console.log("3. Run index.ts to see the bot catch it, execute on Hyperliquid testnet, and settle it!");
        }
    });
}

simulate().catch(console.error);
