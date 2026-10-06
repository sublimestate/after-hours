import { createPublicClient, createWalletClient, http, getContract, parseAbiItem } from "viem";
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

export const escrowAbi = [
    "function intents(bytes32) view returns (address user, string market, bool isLong, uint256 sizeUsd, uint256 deposit, uint256 triggerPrice, bool triggerAbove, uint256 referencePrice, uint256 maxDeviationBps, uint64 expiry, uint256 solverFeeBps, uint256 nonce)",
    "function intentStatuses(bytes32) view returns (uint8)",
    "function fillIntent(bytes32 id, uint256 entryPrice) external",
    "function settleIntent(bytes32 id, uint256 exitPrice) external",
    "event IntentCreated(bytes32 indexed id, (address user, string market, bool isLong, uint256 sizeUsd, uint256 deposit, uint256 triggerPrice, bool triggerAbove, uint256 referencePrice, uint256 maxDeviationBps, uint64 expiry, uint256 solverFeeBps, uint256 nonce) intent)"
] as const;

export const escrowContract = getContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    client: { public: publicClient, wallet: walletClient! }
});
