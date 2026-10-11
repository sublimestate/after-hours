import { walletClient, publicClient, escrowContract, ESCROW_ADDRESS } from "./chain";
import type { Intent } from "./types";

/**
 * Submits the fill transaction to the Base Sepolia escrow contract.
 * Waits for confirmation and returns the hash, or null if the tx reverted.
 */
export async function submitFillOnChain(intent: Intent, entryPrice1e6: bigint): Promise<string | null> {
    if (!walletClient) throw new Error("Wallet client not configured");

    console.log(`[settler] Submitting fill for ${intent.id} at ${entryPrice1e6}`);

    try {
        const hash = await escrowContract.write.fillIntent!([
            intent.id as `0x${string}`,
            entryPrice1e6
        ]);

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
            console.error(`[settler] Fill tx reverted for ${intent.id}: ${hash}`);
            return null;
        }

        console.log(`[settler] Fill confirmed: ${hash}`);
        return hash;
    } catch (error) {
        console.error(`[settler] Failed to submit fill for ${intent.id}:`, error);
        return null;
    }
}

/**
 * Submits the settle transaction to the Base Sepolia escrow contract.
 * Waits for confirmation and returns the hash, or null if the tx reverted.
 */
export async function submitSettleOnChain(intentId: string, exitPrice1e6: bigint): Promise<string | null> {
    if (!walletClient) throw new Error("Wallet client not configured");

    console.log(`[settler] Submitting settle for ${intentId} at ${exitPrice1e6}`);

    try {
        const hash = await escrowContract.write.settleIntent!([
            intentId as `0x${string}`,
            exitPrice1e6
        ]);

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
            console.error(`[settler] Settle tx reverted for ${intentId}: ${hash}`);
            return null;
        }

        console.log(`[settler] Settle confirmed: ${hash}`);
        return hash;
    } catch (error) {
        console.error(`[settler] Failed to submit settle for ${intentId}:`, error);
        return null;
    }
}
