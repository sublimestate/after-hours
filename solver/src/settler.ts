import { walletClient, escrowContract, ESCROW_ADDRESS } from "./chain";
import { Intent } from "./types";

/**
 * Submits the fill transaction to the Base Sepolia escrow contract.
 */
export async function submitFillOnChain(intent: Intent, entryPrice1e6: bigint) {
    if (!walletClient) throw new Error("Wallet client not configured");

    console.log(`[settler] Submitting fill for ${intent.id} at ${entryPrice1e6}`);
    
    try {
        const hash = await escrowContract.write.fillIntent([
            intent.id as `0x${string}`,
            entryPrice1e6
        ]);
        
        console.log(`[settler] Fill tx submitted: ${hash}`);
        return hash;
    } catch (error) {
        console.error(`[settler] Failed to submit fill for ${intent.id}:`, error);
        return null;
    }
}

/**
 * Submits the settle transaction to the Base Sepolia escrow contract.
 */
export async function submitSettleOnChain(intentId: string, exitPrice1e6: bigint) {
    if (!walletClient) throw new Error("Wallet client not configured");

    console.log(`[settler] Submitting settle for ${intentId} at ${exitPrice1e6}`);
    
    try {
        const hash = await escrowContract.write.settleIntent([
            intentId as `0x${string}`,
            exitPrice1e6
        ]);
        
        console.log(`[settler] Settle tx submitted: ${hash}`);
        return hash;
    } catch (error) {
        console.error(`[settler] Failed to submit settle for ${intentId}:`, error);
        return null;
    }
}
