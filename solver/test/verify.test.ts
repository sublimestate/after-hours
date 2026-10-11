import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { recordEvent, getRecords } from "../src/verify";
import type { BookSnapshot } from "../src/hlfeed";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-test-"));

function makeSnapshot(): BookSnapshot {
    return {
        coin: "xyz:GOLD",
        timestamp: Date.now(),
        midPrice1e6: 4000_000000n,
        bids: [{ px: "3999.5", sz: "2.0", n: 3 }],
        asks: [{ px: "4000.5", sz: "1.5", n: 2 }],
    };
}

describe("verify records", () => {
    beforeEach(() => {
        process.env.VERIFY_DATA_DIR = tmpDir;
    });

    afterEach(() => {
        for (const f of fs.readdirSync(tmpDir)) {
            fs.unlinkSync(path.join(tmpDir, f));
        }
    });

    it("persists a FILL record with book snapshot", () => {
        const record = recordEvent("0xabc", "FILL", 4001_000000n, makeSnapshot());
        assert.equal(record.intentId, "0xabc");
        assert.equal(record.event, "FILL");
        assert.equal(record.reportedPx1e6, "4001000000");
        assert.equal(record.bookSnapshot.coin, "xyz:GOLD");
        assert.equal(record.bookSnapshot.bids.length, 1);
        assert.ok(record.explorerUrl.includes("hyperliquid-testnet"));
        assert.ok(record.timestamp > 0);
    });

    it("retrieves records filtered by intent", () => {
        recordEvent("0xabc", "FILL", 4001_000000n, makeSnapshot());
        recordEvent("0xdef", "FILL", 4002_000000n, makeSnapshot());
        recordEvent("0xabc", "SETTLE", 4100_000000n, makeSnapshot());

        const abc = getRecords("0xabc");
        assert.equal(abc.length, 2);
        assert.ok(abc.every((r) => r.intentId === "0xabc"));

        const all = getRecords();
        assert.equal(all.length, 3);
    });

    it("returns empty array when no records exist", () => {
        assert.deepEqual(getRecords("0xnone"), []);
    });
});
