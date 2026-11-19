"use client";

import { useEffect, useState } from "react";

type Event = {kind: "fund" | "attest" | "release" | "cancel"; signature: string; source?: "stream" | "rpc"; latencyMs: number | null};
const labels = {fund: "Funded", attest: "Condition attested", release: "Released", cancel: "Cancelled"};

function useStream(escrow?: string) {
  const [result, setResult] = useState<{healthy: boolean; events: Event[]}>({healthy: false, events: []});
  useEffect(() => {
    const controller = new AbortController();
    const url = escrow ? `/api/devnet/timeline?escrow=${encodeURIComponent(escrow)}` : "/api/devnet/timeline";
    async function refresh() {
      try {
        const response = await fetch(url, {signal: controller.signal, cache: "no-store"});
        if (response.ok) setResult(await response.json());
        else if (!escrow) setResult({healthy: false, events: []});
      } catch {
        if (!escrow && !controller.signal.aborted) setResult({healthy: false, events: []});
      }
    }
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [escrow]);
  return result;
}

export function StreamHealth() {
  const {healthy} = useStream();
  return <p><span className="stream-badge" data-healthy={healthy}>{healthy ? "Stream active" : "No recent stream activity"}</span></p>;
}

export function StreamTimeline({escrow, receipts = []}: {escrow: string; receipts?: {action: Event["kind"]; signature: string}[]}) {
  const {events} = useStream(escrow);
  const seen = new Set(events.map(event => `${event.signature}:${event.kind}`));
  const rows = [...events].reverse().concat(receipts.filter(receipt =>
    !seen.has(`${receipt.signature}:${receipt.action}`)).map(receipt =>
      ({kind: receipt.action, signature: receipt.signature, source: undefined, latencyMs: null})));
  if (!rows.length) return null;
  return <ul className="judge-timeline" aria-label="On-chain activity">
    {rows.map((event, index) => <li key={`${event.signature}:${event.kind}:${index}`}>
      <a className="text-link" href={`https://explorer.solana.com/tx/${event.signature}?cluster=devnet`} target="_blank" rel="noreferrer">{labels[event.kind]} · Solana Explorer</a>
      {event.source && <span className="stream-badge">{event.source === "stream" ? "QuickNode Stream" : "RPC"}</span>}
      {event.latencyMs !== null && <span> seen in {(event.latencyMs / 1000).toFixed(1)} s</span>}
    </li>)}
  </ul>;
}
