import type { Intent } from "./types";
import type { BookSnapshot } from "./hlfeed";

export enum TriggerResult {
    NOT_FIRED,
    BOUND_EXCEEDED,
    READY_TO_FILL
}

/**
 * Evaluates whether an intent's trigger condition has been met by the current orderbook snapshot.
 * If fired, it also validates the deviation bounds against the observed mid price to protect the user.
 */
export function evaluateTrigger(intent: Intent, snapshot: BookSnapshot): TriggerResult {
    const mid = snapshot.midPrice1e6;
    
    // 1. Check trigger condition
    let fired = false;
    if (intent.triggerAbove) {
        fired = mid >= intent.triggerPrice;
    } else {
        fired = mid <= intent.triggerPrice;
    }

    if (!fired) {
        return TriggerResult.NOT_FIRED;
    }

    // 2. Bound check (symmetric, matching the on-chain enforcement):
    // |mid - ref| * 10000 <= maxDeviationBps * ref
    // We use the observed mid as a heuristic for the eventual fill price; the
    // contract re-checks the reported entryPrice on-chain.
    const ref = intent.referencePrice;
    const diff = mid > ref ? mid - ref : ref - mid;
    if (diff * 10000n > intent.maxDeviationBps * ref) {
        console.warn(`[triggers] BOUND_EXCEEDED for ${intent.id}: |mid - ref| = ${diff}, ref = ${ref}`);
        return TriggerResult.BOUND_EXCEEDED;
    }

    return TriggerResult.READY_TO_FILL;
}
