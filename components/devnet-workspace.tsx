"use client";
import {StreamTimeline} from "./stream-timeline";

import Link from "next/link";
import {JudgeDevnet} from "./judge-devnet";
import {useConnection, useWallet} from "@solana/wallet-adapter-react";
import {useEffect, useRef, useState} from "react";
import type {Transaction} from "@solana/web3.js";
import {
  configurePolicy, confirmDevnetTransaction, describeEscrow, devnetProgram, explorer, fetchDevnet,
  formatBaseUnits, fundEscrow, manageEscrow, parseLiveInstruction, toBaseUnits,
  type LiveDraft, type LiveEscrow, type LiveSnapshot,
} from "../lib/devnet";

const flags = {fund:1, release:2, pause:4};
function message(error: unknown) {
  return error instanceof Error ? error.message : "The Solana operation could not finish.";
}

export function DevnetWorkspace() {
  const {connection} = useConnection();
  const {publicKey, sendTransaction, connected} = useWallet();
  const owner = connected ? publicKey : null;
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [messageText, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<LiveDraft | null>(null);
  const [limit, setLimit] = useState("");
  const address = owner?.toBase58();
  const policy = snapshot?.policy;

  useEffect(() => {
    setSnapshot(null);
    setDraft(null);
    setInstruction("");
    setSignature("");
    setMessage("");
  }, [address]);

  useEffect(() => {
    if (!devnetProgram || !owner) return;
    let active = true;
    void fetchDevnet(connection, devnetProgram, owner)
      .then(next => {if (active) setSnapshot(next);})
      .catch(error => {if (active) setMessage(message(error));});
    return () => {active = false;};
  }, [connection, owner, revision]);

  async function execute(makeTransaction: () => Transaction, confirmation: string) {
    if (!owner || !devnetProgram || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSignature("");
    setMessage("Review and sign the Devnet transaction in your wallet.");
    try {
      await confirmDevnetTransaction(connection, devnetProgram, makeTransaction(), owner, sendTransaction, submitted => {
        setSignature(submitted);
        void fetch("/api/devnet/timeline", {
          method: "POST", headers: {"content-type": "application/json"},
          body: JSON.stringify({signature: submitted}), keepalive: true,
        }).catch(() => {});
      });
      setMessage(confirmation);
      return true;
    } catch (error) {
      setMessage(message(error));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
      setRevision(value => value + 1);
    }
  }

  function savePolicy(event: React.FormEvent) {
    event.preventDefault();
    if (!devnetProgram || !owner) return;
    const program = devnetProgram;
    try {
      const value = toBaseUnits(limit.trim());
      if (value < (policy?.committed ?? 0n)) throw Error("The limit must cover held and released payments.");
      void execute(() => configurePolicy(program, owner, value, policy?.flags ?? 3), "Spending limit confirmed on Devnet.");
    } catch (error) {setMessage(message(error));}
  }

  function togglePolicy(flag: number, label: string) {
    if (!devnetProgram || !owner || !policy) return;
    const program = devnetProgram;
    void execute(() => configurePolicy(program, owner, policy.limit, policy.flags ^ flag), label);
  }

  function preview(event: React.FormEvent) {
    event.preventDefault();
    if (!owner) return;
    setDraft(null);
    try {
      setDraft(parseLiveInstruction(instruction, owner));
      setMessage("");
    } catch (error) {setMessage(message(error));}
  }

  async function fund() {
    if (!devnetProgram || !owner || !draft || !policy || !snapshot) return;
    const program = devnetProgram;
    if (draft.amount > snapshot.balance || draft.amount + policy.committed > policy.limit) {
      setMessage("The draft exceeds your Devnet balance or remaining spending limit.");
      return;
    }
    if (await execute(() => fundEscrow(program, owner, draft), "USDC is now in on-chain escrow.")) {
      setDraft(null);
      setInstruction("");
    }
  }

  function manage(escrow: LiveEscrow, action: "attest" | "release" | "cancel") {
    if (!devnetProgram || !owner) return;
    const program = devnetProgram;
    const result = {
      attest:"Condition attestation confirmed on Devnet.",
      release:"Test USDC released to the recipient.",
      cancel:"Escrow cancelled and test USDC returned to the payer.",
    };
    void execute(() => manageEscrow(program, owner, escrow, action), result[action]);
  }

  const paused = Boolean((policy?.flags ?? 0) & flags.pause);
  const funding = Boolean((policy?.flags ?? 0) & flags.fund);
  const releases = Boolean((policy?.flags ?? 0) & flags.release);
  const outstanding = Boolean(busy || !snapshot);

  return <main className="app-main detail-page devnet-page">
    <h1>Solana Devnet</h1>
    <JudgeDevnet/>
    <h2 className="wallet-path-title">Use your own wallet</h2>
    <p>Connect your wallet to sign each test USDC transaction yourself.</p>
    {!devnetProgram ? <p role="status">The on-chain escrow program is currently unavailable. <Link className="text-link" href="/agent">Open the simulated workspace</Link></p>
      : !owner ? <p>Connect a Solana wallet from the header. You’ll need Devnet SOL for fees and test USDC for payments.</p>
      : <>
        <section>
          <h2>Your wallet</h2>
          <p className="wrap-address">{address}</p>
          <p>{snapshot ? `${formatBaseUnits(snapshot.balance)} test USDC available` : "Loading on-chain activity…"}</p>
          <a href="https://faucet.circle.com/" className="text-link" target="_blank" rel="noreferrer">Get test USDC</a>
        </section>
        <section>
          <h2>Spending policy</h2>
          {policy && <p>{formatBaseUnits(policy.committed)} of {formatBaseUnits(policy.limit)} USDC committed or released</p>}
          <form className="settings-form" onSubmit={savePolicy}>
            <label>Spending limit in USDC<input inputMode="decimal" value={limit} onChange={event => setLimit(event.target.value)} placeholder={policy ? formatBaseUnits(policy.limit) : "25.00"} required/></label>
            <button className="button glass" disabled={outstanding}>Save on-chain limit</button>
          </form>
          {policy && <div className="action-list">
            <button className="button glass" disabled={outstanding} onClick={() => togglePolicy(flags.fund, "Funding permission updated.")}>{funding ? "Disable funding" : "Enable funding"}</button>
            <button className="button glass" disabled={outstanding} onClick={() => togglePolicy(flags.release, "Release permission updated.")}>{releases ? "Disable releases" : "Enable releases"}</button>
            <button className="button glass" disabled={outstanding} onClick={() => togglePolicy(flags.pause, "Pause setting confirmed on Devnet.")}>{paused ? "Resume agent" : "Pause agent"}</button>
          </div>}
        </section>
        <section>
          <h2>Draft a payment</h2>
          <p>For example, “Hold 1 USDC for [wallet address] until I receive the files.” The amount, recipient, and condition are public on Devnet.</p>
          <form className="composer" onSubmit={preview}>
            <input aria-label="Devnet payment instruction" maxLength={360} value={instruction} onChange={event => {setInstruction(event.target.value); setDraft(null);}} required/>
            <button className="button primary" disabled={outstanding}>Review</button>
          </form>
          {draft && <div className="devnet-draft">
            <strong>{formatBaseUnits(draft.amount)} test USDC</strong>
            <p className="wrap-address">Recipient: {draft.recipient.toBase58()}</p>
            <p>Release condition: {draft.condition}</p>
            <button className="button primary" type="button" disabled={outstanding || !funding || paused} onClick={() => void fund()}>Fund on Devnet</button>
            {(!funding || paused) && <p>Enable funding and resume the on-chain policy to continue.</p>}
          </div>}
        </section>
        <section>
          <h2>Outgoing escrows</h2>
          {snapshot && !snapshot.outgoing.length && <p>No outgoing Devnet escrows.</p>}
          {snapshot?.outgoing.map(escrow => <article key={escrow.key.toBase58()} className="devnet-escrow">
            <strong>{formatBaseUnits(escrow.amount)} USDC · {describeEscrow(escrow)}</strong>
            <p className="wrap-address">Recipient: {escrow.recipient.toBase58()}</p><p>{escrow.condition}</p>
            <a className="text-link" href={explorer("address",escrow.key.toBase58())} target="_blank" rel="noreferrer">View on Solana Explorer</a>
            <StreamTimeline escrow={escrow.key.toBase58()}/>
            <div className="action-list">
              {escrow.status === 1 && <button className="button glass" disabled={outstanding || paused} onClick={() => manage(escrow,"attest")}>Attest condition met</button>}
              {escrow.status === 2 && <button className="button primary" disabled={outstanding || paused || !releases} onClick={() => manage(escrow,"release")}>Release test USDC</button>}
              {escrow.status < 3 && <button className="button glass" disabled={outstanding} onClick={() => manage(escrow,"cancel")}>Cancel escrow</button>}
            </div>
          </article>)}
        </section>
        <section>
          <h2>Incoming escrows</h2>
          {snapshot && !snapshot.incoming.length && <p>No incoming Devnet escrows.</p>}
          {snapshot?.incoming.map(escrow => <article key={escrow.key.toBase58()} className="devnet-escrow">
            <strong>{formatBaseUnits(escrow.amount)} USDC · {describeEscrow(escrow)}</strong>
            <p>{escrow.condition}</p>
            <a className="text-link" href={explorer("address",escrow.key.toBase58())} target="_blank" rel="noreferrer">View on Solana Explorer</a>
            <StreamTimeline escrow={escrow.key.toBase58()}/>
          </article>)}
        </section>
      </>}
    {(messageText || signature) && <div className="devnet-notice" role="status">
      <p>{messageText}</p>{signature && <a className="text-link" href={explorer("tx",signature)} target="_blank" rel="noreferrer">View transaction</a>}
    </div>}
  </main>;
}
