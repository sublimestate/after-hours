import { useState } from "react";
import { useUserIntents, useVerifyRecords, fmtUsd, fmtPx, UserIntent } from "../hooks";
import { STATUS_LABELS, VerifyRecord } from "../escrow";

function VerifyPanel({ intentId }: { intentId: string }) {
  const { data: records, isLoading } = useVerifyRecords(intentId);

  if (isLoading) return <div className="verify-loading">Loading verification…</div>;
  if (!records || records.length === 0)
    return (
      <div className="verify-empty">
        No solver records yet. Once the solver fills or settles, its reported prices and the
        Hyperliquid order-book snapshot at that moment appear here for independent checking.
      </div>
    );

  return (
    <div className="verify-panel">
      {records.map((r: VerifyRecord, idx: number) => {
        const reported = Number(r.reportedPx1e6) / 1e6;
        const mid = Number(r.bookSnapshot.midPrice1e6) / 1e6;
        const diffBps = mid > 0 ? Math.abs((reported - mid) / mid) * 10000 : 0;
        const ok = diffBps < 50; // within 0.5% of the observed mid
        return (
          <div key={idx} className="verify-record">
            <div className="verify-row">
              <span className="verify-event">{r.event}</span>
              <span className={ok ? "verify-ok" : "verify-warn"}>
                {ok ? "✓ within 0.5% of book mid" : `⚠ ${diffBps.toFixed(1)} bps from mid`}
              </span>
            </div>
            <div className="verify-row">
              <span>Reported price</span>
              <strong>${reported.toFixed(4)}</strong>
            </div>
            <div className="verify-row">
              <span>Book mid at event</span>
              <span>${mid.toFixed(4)}</span>
            </div>
            <div className="verify-book">
              <div className="book-side">
                <div className="book-title">Bids</div>
                {r.bookSnapshot.bids.map((b, i) => (
                  <div key={i} className="book-level">
                    <span>{b.px}</span>
                    <span>{b.sz}</span>
                  </div>
                ))}
              </div>
              <div className="book-side">
                <div className="book-title">Asks</div>
                {r.bookSnapshot.asks.map((a, i) => (
                  <div key={i} className="book-level">
                    <span>{a.px}</span>
                    <span>{a.sz}</span>
                  </div>
                ))}
              </div>
            </div>
            <a href={r.explorerUrl} target="_blank" rel="noreferrer" className="verify-link">
              View on Hyperliquid explorer ↗
            </a>
            <div className="verify-ts">
              {new Date(r.timestamp).toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IntentCard({ intent }: { intent: UserIntent }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_LABELS[intent.status] ?? "UNKNOWN";
  const expiryDate = new Date(Number(intent.expiry) * 1000).toLocaleString();

  return (
    <div className="intent-card card">
      <div className="intent-header" onClick={() => setExpanded(!expanded)}>
        <div>
          <strong>{intent.market}</strong>{" "}
          <span className={intent.isLong ? "long" : "short"}>
            {intent.isLong ? "LONG" : "SHORT"}
          </span>
        </div>
        <div className="intent-meta">
          <span>{fmtUsd(intent.sizeUsd)}</span>
          <span className={`status status-${status.toLowerCase()}`}>{status}</span>
          <span className="expand-hint">{expanded ? "▾" : "▸"}</span>
        </div>
      </div>
      {expanded && (
        <div className="intent-detail">
          <div className="detail-grid">
            <div><span>Trigger</span><strong>{intent.triggerAbove ? "≥" : "≤"} ${fmtPx(intent.triggerPrice)}</strong></div>
            <div><span>Reference</span><strong>${fmtPx(intent.referencePrice)}</strong></div>
            <div><span>Max deviation</span><strong>{(Number(intent.maxDeviationBps) / 100).toFixed(1)}%</strong></div>
            <div><span>Deposit</span><strong>{fmtUsd(intent.deposit)}</strong></div>
            <div><span>Expiry</span><strong>{expiryDate}</strong></div>
            {intent.entryPrice && (
              <div><span>Entry price</span><strong>${fmtPx(intent.entryPrice)}</strong></div>
            )}
          </div>
          <h4>Verification</h4>
          <VerifyPanel intentId={intent.id} />
        </div>
      )}
    </div>
  );
}

export function IntentsList({ userAddress }: { userAddress: `0x${string}` | undefined }) {
  const { data: intents, isLoading, error } = useUserIntents(userAddress);

  if (isLoading) return <div className="card">Loading your intents…</div>;
  if (error) return <div className="card">Couldn't load intents. Is the escrow address set?</div>;
  if (!intents || intents.length === 0)
    return <div className="card empty">No intents yet — create one above.</div>;

  return (
    <div className="intents-list">
      {intents.map((intent) => (
        <IntentCard key={intent.id} intent={intent} />
      ))}
    </div>
  );
}
