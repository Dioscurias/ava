"use client";
import {StreamTimeline} from "./stream-timeline";

import {useCallback, useEffect, useRef, useState} from "react";
import type {JudgeAction, getJudgeStatus, runJudgeAction} from "../lib/judge-devnet.server";

type Status = Awaited<ReturnType<typeof getJudgeStatus>>;
type Receipt = Awaited<ReturnType<typeof runJudgeAction>>;
type Run = {requestId: string; condition: string; receipts: Receipt[]};
const storageKey = "ava-devnet-judge-runs";

export function JudgeDevnet() {
  const [status,setStatus] = useState<Status|null>(null);
  const [statusError,setStatusError] = useState("");
  const [runs,setRuns] = useState<Run[]>([]);
  const [loaded,setLoaded] = useState(false);
  const [condition,setCondition] = useState("The final files have been delivered");
  const [accessCode,setAccessCode] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const locked = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/devnet/status",{cache:"no-store"});
      const data = await response.json();
      if (!response.ok || !data.judge) throw Error(data.error || "Devnet status is unavailable.");
      setStatus(data);
      setStatusError(data.error || "");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "Devnet status is unavailable.");
    }
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) setRuns(JSON.parse(saved));
    } catch { /* The current session still works without storage. */ }
    setLoaded(true);
    void refresh();
  },[refresh]);

  useEffect(()=>{
    if (!loaded) return;
    try {sessionStorage.setItem(storageKey,JSON.stringify(runs));} catch { /* Browser storage is optional. */ }
  },[loaded,runs]);

  async function execute(action: JudgeAction, run: Run) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("Waiting for Devnet confirmation…");
    try {
      const response = await fetch(`/api/devnet/${action}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({requestId:run.requestId,condition:run.condition,proof:run.receipts[0]?.proof,accessCode}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Devnet did not confirm the transaction.");
      const receipt = data as Receipt;
      setRuns(prev=>prev.map(item=>item.requestId===run.requestId
        ? {...item,receipts:[...item.receipts.filter(previous=>previous.action!==action),receipt]} : item));
      setMessage("Confirmed on Solana Devnet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Devnet did not confirm the transaction.");
    } finally {
      locked.current = false;
      setBusy(false);
      void refresh();
    }
  }

  function start(event: React.FormEvent) {
    event.preventDefault();
    if (!condition.trim() || locked.current) return;
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,"0")).join("");
    const run = {requestId,condition:condition.trim(),receipts:[]};
    setRuns(previous=>[run,...previous]);
    void execute("fund",run);
  }

  return <section className="judge-devnet" aria-labelledby="judge-title">
    <h2 id="judge-title">Judge mode · Devnet test funds</h2>
    <p>Try a 0.10 USDC escrow without connecting a wallet. Ava sponsors the Devnet fees and sends test funds only to its demo recipient.</p>
    <dl className="judge-status">
      <div><dt>Cluster</dt><dd>Solana Devnet</dd></div>
      <div><dt>RPC</dt><dd>{status ? status.rpc.healthy ? `Healthy · slot ${status.rpc.slot}` : "Unavailable" : "Checking…"}</dd></div>
      <div><dt>Program</dt><dd>{status?.programExplorerUrl ? <a className="text-link wrap-address" href={status.programExplorerUrl} target="_blank" rel="noreferrer">{status.programId}</a> : "Unconfigured"}{status?.programId && <span> · {status.programExecutable ? "Executable" : "Awaiting deployment"}</span>}</dd></div>
      <div><dt>Mint</dt><dd>{status?.classicSpl ? `Classic SPL USDC · ${status.decimals} decimals` : "USDC verification pending"}</dd></div>
      <div><dt>Judge payer</dt><dd>{status?.judge.payer ? <>{status.judge.payer.testUsdc ?? "—"} test USDC · {status.judge.payer.sol ?? "—"} SOL<p className="wrap-address">{status.judge.payer.address}</p></> : "Unconfigured"}</dd></div>
      <div><dt>Judge recipient</dt><dd>{status?.judge.recipient ? <>{status.judge.recipient.testUsdc ?? "—"} test USDC · {status.judge.recipient.sol ?? "—"} SOL<p className="wrap-address">{status.judge.recipient.address}</p></> : "Unconfigured"}</dd></div>
    </dl>
    <button className="button glass" onClick={()=>void refresh()}>Refresh Devnet status</button>
    {statusError && <p role="status">{statusError}</p>}
    {status?.judge.accessCodeRequired && <label className="judge-field">Judge access code<input type="password" value={accessCode} onChange={event=>setAccessCode(event.target.value)}/></label>}
    {status?.judge.ready ? <form onSubmit={start} className="judge-form">
      <label className="judge-field">Release condition <input value={condition} onChange={event=>setCondition(event.target.value)} maxLength={160} required/></label>
      <p>The condition is published on Devnet. Attest only after checking it.</p>
      <button className="button primary" disabled={busy||!loaded}>Create and fund 0.10 test USDC</button>
    </form> : <p>Judge mode opens after the escrow program is deployed and the sponsor has test USDC and Devnet SOL.</p>}
    {message && <p className="devnet-notice" role="status">{message}</p>}
    {runs.map(run=>{
      const first=run.receipts[0];
      const last=run.receipts.at(-1)?.action;
      return <article className="judge-run" key={run.requestId}>
        <h3>{run.condition}</h3>
        {first ? <a className="text-link" href={first.escrowExplorerUrl} target="_blank" rel="noreferrer">View escrow account</a> : <p>Funding has not been confirmed.</p>}
        {first && <StreamTimeline escrow={first.escrow} receipts={run.receipts}/>}
        <div className="action-list">
          {!first && <button className="button glass" disabled={busy} onClick={()=>void execute("fund",run)}>Retry funding</button>}
          {last==="fund" && <button className="button glass" disabled={busy} onClick={()=>void execute("attest",run)}>Attest condition met</button>}
          {last==="attest" && <button className="button primary" disabled={busy} onClick={()=>void execute("release",run)}>Release test USDC</button>}
          {(last==="fund"||last==="attest") && <button className="button glass" disabled={busy} onClick={()=>void execute("cancel",run)}>Cancel and refund</button>}
        </div>
      </article>;
    })}
  </section>;
}
