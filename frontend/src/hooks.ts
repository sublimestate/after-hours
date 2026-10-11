import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { ESCROW_ADDRESS, ESCROW_ABI, VerifyRecord } from "./escrow";

export interface UserIntent {
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
  expiry: bigint;
  solverFeeBps: bigint;
  nonce: bigint;
  status: number;
  entryPrice: bigint | null;
}

/**
 * Fetches the connected user's intents: scans IntentCreated events,
 * filters by user, and enriches with live status + entry price.
 */
export function useUserIntents(userAddress: `0x${string}` | undefined) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["intents", userAddress, ESCROW_ADDRESS],
    enabled: !!userAddress && !!publicClient && ESCROW_ADDRESS !== "0x0000000000000000000000000000000000000000",
    queryFn: async (): Promise<UserIntent[]> => {
      const logs = await publicClient!.getContractEvents({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        eventName: "IntentCreated",
        fromBlock: 0n,
      });

      const mine = logs.filter(
        (l: any) => l.args.intent.user.toLowerCase() === userAddress!.toLowerCase()
      );

      const intents: UserIntent[] = [];
      for (const log of mine as any[]) {
        const id = log.args.id as `0x${string}`;
        const [status, entryPrice] = await Promise.all([
          publicClient!.readContract({
            address: ESCROW_ADDRESS,
            abi: ESCROW_ABI,
            functionName: "intentStatuses",
            args: [id],
          }),
          publicClient!.readContract({
            address: ESCROW_ADDRESS,
            abi: ESCROW_ABI,
            functionName: "entryPrices",
            args: [id],
          }),
        ]);
        const i = log.args.intent;
        intents.push({
          id,
          user: i.user,
          market: i.market,
          isLong: i.isLong,
          sizeUsd: i.sizeUsd,
          deposit: i.deposit,
          triggerPrice: i.triggerPrice,
          triggerAbove: i.triggerAbove,
          referencePrice: i.referencePrice,
          maxDeviationBps: i.maxDeviationBps,
          expiry: i.expiry,
          solverFeeBps: i.solverFeeBps,
          nonce: i.nonce,
          status: Number(status),
          entryPrice: (entryPrice as bigint) > 0n ? (entryPrice as bigint) : null,
        });
      }
      // Newest first
      return intents.reverse();
    },
    refetchInterval: 10000,
  });
}

/**
 * Fetches the solver's verify records (written by solver/src/verify.ts).
 * For the demo the solver writes these to frontend/public/verify-records.json.
 */
export function useVerifyRecords(intentId?: string) {
  return useQuery({
    queryKey: ["verify-records"],
    queryFn: async (): Promise<VerifyRecord[]> => {
      const res = await fetch("/verify-records.json");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 10000,
    select: (records) =>
      intentId ? records.filter((r) => r.intentId.toLowerCase() === intentId.toLowerCase()) : records,
  });
}

export function fmtUsd(v: bigint): string {
  return `$${(Number(v) / 1e6).toFixed(2)}`;
}

export function fmtPx(v: bigint): string {
  return (Number(v) / 1e6).toFixed(4);
}
