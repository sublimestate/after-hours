import { Intent } from "./types";
import { BookSnapshot } from "./hlfeed";

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

    // 2. Bound check
    // If long: entryPrice <= ref + (ref * maxDeviationBps / 10000)
    // If short: entryPrice >= ref - (ref * maxDeviationBps / 10000)
    // Note: the actual entryPrice on Hyperliquid might have slight slippage from the mid, 
    // but we use the observed mid as a heuristic to see if the bound is already violated.
    
    const ref = intent.referencePrice;
    const maxDev = (ref * intent.maxDeviationBps) / 10000n;
    
    if (intent.isLong) {
        const maxAcceptable = ref + maxDev;
        if (mid > maxAcceptable) {
            console.warn(`[triggers] BOUND_EXCEEDED for ${intent.id} (Long): Mid ${mid} > Max ${maxAcceptable}`);
            return TriggerResult.BOUND_EXCEEDED;
        }
    } else {
        const minAcceptable = ref - maxDev;
        if (mid < minAcceptable) {
            console.warn(`[triggers] BOUND_EXCEEDED for ${intent.id} (Short): Mid ${mid} < Min ${minAcceptable}`);
            return TriggerResult.BOUND_EXCEEDED;
        }
    }

    return TriggerResult.READY_TO_FILL;
}
