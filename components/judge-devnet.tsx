"use client";
import {displayCondition} from "../lib/payments";
import Link from "next/link";
import {StreamTimeline} from "./stream-timeline";

import {useCallback, useEffect, useId, useRef, useState} from "react";
import type {JudgeAction, getJudgeStatus, runJudgeAction} from "../lib/judge-devnet.server";

type Status = Awaited<ReturnType<typeof getJudgeStatus>>;
type Receipt = Awaited<ReturnType<typeof runJudgeAction>>;
type Run = {requestId: string; condition: string; receipts: Receipt[]};
const storageKey = "ava-devnet-judge-runs";
const stepLabels = {
  fund: "Create and fund escrow",
  attest: "Attest condition met",
  release: "Release test USDC",
  cancel: "Cancel and refund",
} satisfies Record<JudgeAction, string>;

function ReceiptList({receipts}: {receipts: Receipt[]}) {
  return <ul aria-label="Transaction signatures" className="judge-timeline">
    {receipts.map(receipt => <li key={receipt.signature}>
      <a className="text-link wrap-address" href={receipt.explorerUrl} target="_blank" rel="noreferrer">{stepLabels[receipt.action]}: {receipt.signature}</a>
    </li>)}
  </ul>;
}

export function JudgeReceiptDetail({requestId}: {requestId: string}) {
  const [run, setRun] = useState<Run>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const runs: Run[] = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
      setRun(runs.find(item => item.requestId === requestId));
    } catch { /* The receipt may be unavailable outside this session. */ }
    setLoaded(true);
  }, [requestId]);
  const receipt = run?.receipts[0];
  return <main className="app-main detail-page">
    <h1>Devnet payment</h1>
    {!loaded ? <p role="status">Loading receipt…</p> : run && receipt ? <>
      <p>{receipt.amount} test USDC</p>
      <p className="wrap-address">Recipient: {receipt.recipient}</p>
      <p>{displayCondition(run.condition)}</p>
      <a className="text-link" href={receipt.escrowExplorerUrl} target="_blank" rel="noreferrer">View escrow on Solana Explorer</a>
      <ReceiptList receipts={run.receipts}/>
    </> : <p>This receipt is available in the browser session that ran the escrow.</p>}
    <Link className="text-link" href="/devnet">Back to Devnet</Link>
  </main>;
}

export function JudgeDevnet({draftCondition, fundingBlocked = false, draftConfirmed = false, onFunded}: {draftCondition?: string; fundingBlocked?: boolean; draftConfirmed?: boolean; onFunded?: (condition: string, receipt: Receipt) => void} = {}) {
  const heading = useId();
  const inChat = draftCondition !== undefined;
  const [status,setStatus] = useState<Status|null>(null);
  const [statusError,setStatusError] = useState("");
  const [runs,setRuns] = useState<Run[]>([]);
  const [loaded,setLoaded] = useState(false);
  const demoCondition = "Judge approves this demonstration release";
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

  async function execute(actions: JudgeAction[], run: Run) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    let current = run;
    try {
      for (const action of actions) {
        setMessage(`${stepLabels[action]}… waiting for Devnet confirmation.`);
        const response = await fetch(`/api/devnet/${action}`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({requestId: run.requestId, condition: run.condition, proof: current.receipts[0]?.proof, accessCode}),
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Devnet did not confirm the transaction.");
        const receipt = data as Receipt;
        const updated = {...current, receipts: [...current.receipts.filter(previous => previous.action !== action), receipt]};
        current = updated;
        setRuns(previous => previous.map(item => item.requestId === run.requestId ? updated : item));
        if (action === "fund") onFunded?.(run.condition, receipt);
      }
      setMessage(actions.at(-1) === "release" ? "0.10 test USDC released on Solana Devnet." : "Confirmed on Solana Devnet.");
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
    const terms = (draftCondition ?? demoCondition).trim();
    if (!terms || locked.current || fundingBlocked || draftConfirmed || !status?.judge.ready) return;
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,"0")).join("");
    const run = {requestId,condition:terms,receipts:[]};
    setRuns(previous=>[run,...previous]);
    void execute(inChat ? ["fund"] : ["fund", "attest", "release"],run);
  }

  return <section className="judge-devnet" aria-labelledby={heading}>
    <h2 id={heading}>Judge mode · Devnet test funds</h2>
    <p>Try a 0.10 USDC escrow without connecting a wallet. Ava sponsors the Devnet fees and sends test funds only to its demo recipient.</p>
    {inChat && <p>Your draft supplies the release condition. The sponsored transaction uses 0.10 test USDC and the fixed demo wallet shown below.</p>}
    <dl className="judge-status">
      <div><dt>Cluster</dt><dd>Solana Devnet</dd></div>
      <div><dt>RPC</dt><dd>{status ? status.rpc.healthy ? `Healthy · slot ${status.rpc.slot}` : "Unavailable" : "Checking…"}</dd></div>
      <div><dt>Program</dt><dd>{status?.programExplorerUrl ? <a className="text-link wrap-address" href={status.programExplorerUrl} target="_blank" rel="noreferrer">{status.programId}</a> : "Unconfigured"}{status?.programId && <span> · Configured · {status.programExecutable ? "Executable" : "Awaiting deployment"}</span>}</dd></div>
      <div><dt>Mint</dt><dd>{status ? <><a className="text-link wrap-address" href={status.mintExplorerUrl} target="_blank" rel="noreferrer">{status.mint}</a>{status.classicSpl && <span> · {status.decimals} decimals</span>}</> : "USDC verification pending"}</dd></div>
      <div><dt>Judge payer</dt><dd>{status?.judge.payer ? <>{status.judge.payer.testUsdc ?? "—"} test USDC · {status.judge.payer.sol ?? "—"} SOL<p><a className="text-link wrap-address" href={`https://explorer.solana.com/address/${status.judge.payer.address}?cluster=devnet`} target="_blank" rel="noreferrer">{status.judge.payer.address}</a> · Configured</p></> : "Unconfigured"}</dd></div>
      <div><dt>Judge recipient</dt><dd>{status?.judge.recipient ? <>{status.judge.recipient.testUsdc ?? "—"} test USDC · {status.judge.recipient.sol ?? "—"} SOL<p><a className="text-link wrap-address" href={`https://explorer.solana.com/address/${status.judge.recipient.address}?cluster=devnet`} target="_blank" rel="noreferrer">{status.judge.recipient.address}</a> · Configured</p></> : "Unconfigured"}</dd></div>
    </dl>
    <button className="button glass" onClick={()=>void refresh()}>Refresh Devnet status</button>
    {statusError && <p role="status">{statusError}</p>}
    {status?.judge.accessCodeRequired && <label className="judge-field">Judge access code<input type="password" value={accessCode} onChange={event=>setAccessCode(event.target.value)}/></label>}
    {draftConfirmed ? null : status?.judge.ready ? <form onSubmit={start} className="judge-form">
      <p>{inChat ? `Release condition: ${draftCondition}` : "This run approves its own demo condition and releases the test funds to the fixed recipient."}</p>
      {inChat && <p>The condition is published on Devnet. Attest after checking it.</p>}
      <button className="button primary" disabled={busy||!loaded||fundingBlocked}>{inChat ? "Confirm 0.10 test USDC escrow" : "Run 0.10 USDC escrow"}</button>
    </form> : <p>Judge mode opens after the escrow program is deployed and the sponsor has test USDC and Devnet SOL.</p>}
    {status?.rpc.healthy && status.judge.payer && ((status.judge.payer.sol ?? 0) < 0.02 || Number(status.judge.payer.testUsdc ?? 0) < 0.10) &&
      <p role="status">The judge payer needs at least 0.02 Devnet SOL and 0.10 test USDC to fund an escrow.</p>}
    {status?.judge.configured && !status.judge.dailyCapConfigured && <p>Sponsor funding requires the server-side daily cap.</p>}
    {fundingBlocked && <p role="status">The workspace currently blocks funding.</p>}
    {message && <p className="devnet-notice" role="status">{message}</p>}
    {runs.map(run=>{
      const first=run.receipts[0];
      const last=run.receipts.at(-1)?.action;
      return <article className="judge-run" key={run.requestId}>
        <h3>{first ? "Confirmed payment" : "Escrow draft"}</h3>
        <p>{displayCondition(run.condition)}</p>
        {first ? <a className="text-link" href={first.escrowExplorerUrl} target="_blank" rel="noreferrer">View escrow account</a> : <p>Funding has not been confirmed.</p>}
        {first && <>
          <p><Link className="text-link" href={`/payments/DV-${run.requestId}`}>Open payment receipt</Link></p>
          <ReceiptList receipts={run.receipts}/>
        </>}
        {first && <StreamTimeline escrow={first.escrow} receipts={run.receipts}/>}
        <div className="action-list">
          {!first && <button className="button glass" disabled={busy||fundingBlocked} onClick={()=>void execute(["fund"],run)}>Retry funding</button>}
          {last==="fund" && <button className="button glass" disabled={busy} onClick={()=>void execute(["attest"],run)}>Attest condition met</button>}
          {last==="attest" && <button className="button primary" disabled={busy} onClick={()=>void execute(["release"],run)}>Release test USDC</button>}
          {(last==="fund"||last==="attest") && <button className="button glass" disabled={busy} onClick={()=>void execute(["cancel"],run)}>Cancel and refund</button>}
        </div>
      </article>;
    })}
  </section>;
}
