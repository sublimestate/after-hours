import { createPublicClient, createWalletClient, http, getContract, parseAbiItem, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import dotenv from "dotenv";

dotenv.config();

export const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;
const OPERATOR_KEY = process.env.OPERATOR_KEY as `0x${string}`;

export const account = OPERATOR_KEY ? privateKeyToAccount(OPERATOR_KEY) : null;

export const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_RPC_URL)
});

export const walletClient = account ? createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(process.env.BASE_RPC_URL)
}) : null;

export const escrowAbi = parseAbi([
    "function intents(bytes32) view returns (address user, string market, bool isLong, uint256 sizeUsd, uint256 deposit, uint256 triggerPrice, bool triggerAbove, uint256 referencePrice, uint256 maxDeviationBps, uint64 expiry, uint256 solverFeeBps, uint256 nonce)",
    "function intentStatuses(bytes32) view returns (uint8)",
    "function entryPrices(bytes32) view returns (uint256)",
    "function createIntent((address user, string market, bool isLong, uint256 sizeUsd, uint256 deposit, uint256 triggerPrice, bool triggerAbove, uint256 referencePrice, uint256 maxDeviationBps, uint64 expiry, uint256 solverFeeBps, uint256 nonce) i, bytes sig) external",
    "function fillIntent(bytes32 id, uint256 entryPrice) external",
    "function settleIntent(bytes32 id, uint256 exitPrice) external",
    "event IntentCreated(bytes32 indexed id, (address user, string market, bool isLong, uint256 sizeUsd, uint256 deposit, uint256 triggerPrice, bool triggerAbove, uint256 referencePrice, uint256 maxDeviationBps, uint64 expiry, uint256 solverFeeBps, uint256 nonce) intent)"
]);

export const escrowContract = getContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    client: { public: publicClient, wallet: walletClient! }
});

export interface ChainIntent {
    id: `0x${string}`;
    user: `0x${string}`;
    market: string;
    isLong: boolean;
    sizeUsd: bigint;
    deposit: bigint;
    triggerPrice: bigint;
    triggerAbove: boolean;
    referencePrice: bigint;
    maxDeviationBps: bigint;
    expiry: number;
    solverFeeBps: bigint;
    nonce: bigint;
}

/**
 * Fetches all OPEN intents by scanning IntentCreated events and filtering by status.
 * Used on boot to pick up intents created while the bot was offline.
 */
export async function fetchOpenIntents(fromBlock: bigint = 0n): Promise<ChainIntent[]> {
    const logs = (await publicClient.getContractEvents({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        eventName: "IntentCreated",
        fromBlock,
    })) as unknown as Array<{ args: { id: `0x${string}` } }>;

    const open: ChainIntent[] = [];
    for (const log of logs) {
        const id = log.args.id;
        const status = (await publicClient.readContract({
            address: ESCROW_ADDRESS,
            abi: escrowAbi,
            functionName: "intentStatuses",
            args: [id],
        })) as number;
        // Status.OPEN = 0
        if (status !== 0) continue;

        const intent = (await publicClient.readContract({
            address: ESCROW_ADDRESS,
            abi: escrowAbi,
            functionName: "intents",
            args: [id],
        })) as [
            `0x${string}`, string, boolean, bigint, bigint, bigint,
            boolean, bigint, bigint, bigint, bigint, bigint
        ];

        open.push({
            id,
            user: intent[0],
            market: intent[1],
            isLong: intent[2],
            sizeUsd: intent[3],
            deposit: intent[4],
            triggerPrice: intent[5],
            triggerAbove: intent[6],
            referencePrice: intent[7],
            maxDeviationBps: intent[8],
            expiry: Number(intent[9]),
            solverFeeBps: intent[10],
            nonce: intent[11],
        });
    }
    return open;
}
