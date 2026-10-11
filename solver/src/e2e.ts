/**
 * End-to-end testnet run: create intent → trigger → fill → settle.
 * Uses the solver key as both user and solver (test setup).
 */
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { baseSepolia } from "viem/chains";
import { fetchL2BookMid } from "./hlfeed";
import { evaluateTrigger, TriggerResult } from "./triggers";
import { recordEvent } from "./verify";
import { ESCROW_ADDRESS, escrowAbi } from "./chain";
import dotenv from "dotenv";

dotenv.config();

const OPERATOR_KEY = process.env.OPERATOR_KEY as `0x${string}`;
const account = privateKeyToAccount(OPERATOR_KEY);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) });

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;
const ESCROW = "0xb5af8a8bed7272b0b9b0144d58dc86912a6f7dd4" as `0x${string}`;

async function main() {
    console.log("=== AfterHours E2E Testnet Run ===");
    console.log("Account:", account.address);

    // 1. Get current price
    const book = await fetchL2BookMid("xyz:GOLD");
    if (!book) throw new Error("No book");
    const mid = book.midPrice1e6;
    console.log("xyz:GOLD mid:", Number(mid) / 1e6);

    // 2. Build intent (trigger fires immediately)
    const nonce = BigInt(Date.now());
    const intent = {
        user: account.address,
        market: "xyz:GOLD",
        isLong: true,
        sizeUsd: 10_000000n,
        deposit: 12_000000n,
        triggerPrice: mid - (mid * 100n / 10000n), // 1% below mid
        triggerAbove: true, // fires immediately
        referencePrice: mid,
        maxDeviationBps: 500n,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
        solverFeeBps: 50n,
        nonce,
    };

    // 3. Sign EIP-712
    const domain = {
        name: "AfterHours",
        version: "1",
        chainId: 84532,
        verifyingContract: ESCROW,
    } as const;
    const types = {
        Intent: [
            { name: "user", type: "address" },
            { name: "market", type: "string" },
            { name: "isLong", type: "bool" },
            { name: "sizeUsd", type: "uint256" },
            { name: "deposit", type: "uint256" },
            { name: "triggerPrice", type: "uint256" },
            { name: "triggerAbove", type: "bool" },
            { name: "referencePrice", type: "uint256" },
            { name: "maxDeviationBps", type: "uint256" },
            { name: "expiry", type: "uint64" },
            { name: "solverFeeBps", type: "uint256" },
            { name: "nonce", type: "uint256" },
        ],
    } as const;

    const sig = await account.signTypedData({
        domain, types, primaryType: "Intent", message: intent,
    });
    console.log("Signed.");

    // 4. Approve + createIntent
    const approveHash = await walletClient.writeContract({
        address: USDC,
        abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const,
        functionName: "approve",
        args: [ESCROW, intent.deposit],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Approved:", approveHash);

    const createHash = await walletClient.writeContract({
        address: ESCROW,
        abi: escrowAbi,
        functionName: "createIntent",
        args: [intent, sig],
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    console.log("Intent created:", createHash);

    // Get intent id from the IntentCreated event
    const logs = await publicClient.getContractEvents({
        address: ESCROW,
        abi: escrowAbi,
        eventName: "IntentCreated",
        fromBlock: createReceipt.blockNumber,
        toBlock: createReceipt.blockNumber,
    });
    const id = (logs[0] as any).args.id as `0x${string}`;
    console.log("Intent ID:", id);

    // 5. Solver: evaluate trigger
    const fullIntent = { id, ...intent, expiry: Number(intent.expiry) };
    const result = evaluateTrigger(fullIntent as any, book);
    console.log("Trigger result:", TriggerResult[result]);
    if (result !== TriggerResult.READY_TO_FILL) throw new Error("Trigger did not fire");

    // 6. Fill (mock HL execution at mid, as executor does)
    const fillPrice = mid;
    recordEvent(id, "FILL", fillPrice, book);
    const fillHash = await walletClient.writeContract({
        address: ESCROW,
        abi: escrowAbi,
        functionName: "fillIntent",
        args: [id, fillPrice],
    });
    await publicClient.waitForTransactionReceipt({ hash: fillHash });
    console.log("Filled:", fillHash);

    // 7. Settle at +2% (user profits)
    const exitPrice = mid + (mid * 200n / 10000n);
    const book2 = await fetchL2BookMid("xyz:GOLD");
    recordEvent(id, "SETTLE", exitPrice, book2 ?? book);
    const settleHash = await walletClient.writeContract({
        address: ESCROW,
        abi: escrowAbi,
        functionName: "settleIntent",
        args: [id, exitPrice],
    });
    await publicClient.waitForTransactionReceipt({ hash: settleHash });
    console.log("Settled:", settleHash);

    // 8. Verify final status
    const status = await publicClient.readContract({
        address: ESCROW, abi: escrowAbi, functionName: "intentStatuses", args: [id],
    });
    console.log("Final status:", status, "(2 = SETTLED)");
    console.log("=== E2E COMPLETE ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
