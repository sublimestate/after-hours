import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateTrigger, TriggerResult } from "../src/triggers";
import type { Intent } from "../src/types";
import type { BookSnapshot } from "../src/hlfeed";

function makeIntent(overrides: Partial<Intent> = {}): Intent {
    return {
        id: "0xtest",
        user: "0xuser",
        market: "xyz:GOLD",
        isLong: true,
        sizeUsd: 10_000000n,
        deposit: 12_000000n,
        triggerPrice: 4000_000000n,
        triggerAbove: true,
        referencePrice: 4000_000000n,
        maxDeviationBps: 500n, // 5% => [3800, 4200]
        expiry: Math.floor(Date.now() / 1000) + 3600,
        solverFeeBps: 50n,
        nonce: 1n,
        ...overrides,
    };
}

function makeSnapshot(mid1e6: bigint): BookSnapshot {
    return {
        coin: "xyz:GOLD",
        timestamp: Date.now(),
        midPrice1e6: mid1e6,
        bids: [{ px: "3999", sz: "1", n: 1 }],
        asks: [{ px: "4001", sz: "1", n: 1 }],
    };
}

describe("evaluateTrigger", () => {
    it("returns NOT_FIRED when trigger condition not met", () => {
        const intent = makeIntent({ triggerAbove: true, triggerPrice: 4100_000000n });
        const result = evaluateTrigger(intent, makeSnapshot(4000_000000n));
        assert.equal(result, TriggerResult.NOT_FIRED);
    });

    it("fires when mid >= triggerPrice (triggerAbove)", () => {
        const intent = makeIntent({ triggerAbove: true, triggerPrice: 4000_000000n });
        const result = evaluateTrigger(intent, makeSnapshot(4000_000000n));
        assert.equal(result, TriggerResult.READY_TO_FILL);
    });

    it("fires when mid <= triggerPrice (!triggerAbove)", () => {
        const intent = makeIntent({ triggerAbove: false, triggerPrice: 4000_000000n });
        const result = evaluateTrigger(intent, makeSnapshot(4000_000000n));
        assert.equal(result, TriggerResult.READY_TO_FILL);
    });

    it("returns BOUND_EXCEEDED when mid is above ref + maxDev (symmetric)", () => {
        const intent = makeIntent({ triggerAbove: true, triggerPrice: 4000_000000n });
        // 5% above 4000 = 4200; 4201 exceeds
        const result = evaluateTrigger(intent, makeSnapshot(4201_000000n));
        assert.equal(result, TriggerResult.BOUND_EXCEEDED);
    });

    it("returns BOUND_EXCEEDED when mid is below ref - maxDev (symmetric)", () => {
        const intent = makeIntent({ triggerAbove: false, triggerPrice: 4000_000000n });
        // 5% below 4000 = 3800; 3799 exceeds
        const result = evaluateTrigger(intent, makeSnapshot(3799_000000n));
        assert.equal(result, TriggerResult.BOUND_EXCEEDED);
    });

    it("accepts fills at exactly the bound edge", () => {
        const intent = makeIntent({ triggerAbove: true, triggerPrice: 4000_000000n });
        assert.equal(evaluateTrigger(intent, makeSnapshot(4200_000000n)), TriggerResult.READY_TO_FILL);
        const short = makeIntent({ isLong: false, triggerAbove: false, triggerPrice: 4000_000000n });
        assert.equal(evaluateTrigger(short, makeSnapshot(3800_000000n)), TriggerResult.READY_TO_FILL);
    });

    it("bound check is symmetric regardless of side", () => {
        // A long and a short with the same ref/deviation should agree on the bound
        const long = makeIntent({ isLong: true, triggerAbove: true, triggerPrice: 4000_000000n });
        const short = makeIntent({ isLong: false, triggerAbove: true, triggerPrice: 4000_000000n });
        const highMid = makeSnapshot(4201_000000n);
        assert.equal(evaluateTrigger(long, highMid), TriggerResult.BOUND_EXCEEDED);
        assert.equal(evaluateTrigger(short, highMid), TriggerResult.BOUND_EXCEEDED);
    });
});
