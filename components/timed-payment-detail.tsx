"use client";
import {displayCondition} from "../lib/payments";

import Link from "next/link";
import {useConnection, useWallet} from "@solana/wallet-adapter-react";
import {PublicKey, SYSVAR_CLOCK_PUBKEY} from "@solana/web3.js";
import {useEffect, useRef, useState} from "react";
import {
  confirmDevnetTransaction, describeEscrow, devnetGenesis, devnetProgram, explorer, formatBaseUnits,
  manageEscrow, manageTimedEscrow, policyAddress, storedEscrow, type LiveEscrow, type TimedAction,
} from "../lib/devnet";
import {StreamTimeline} from "./stream-timeline";

const actions = {
  deliver:"Mark delivered", claim:"Claim USDC", refund:"Refund USDC", dispute:"Dispute delivery",
  resolveRelease:"Resolve and release", resolveRefund:"Resolve and refund", release:"Release early",
};
type Action = keyof typeof actions;

function remaining(end: number, now: number) {
  const seconds = Math.max(0, end - now);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return [hours ? `${hours}h` : "", `${minutes}m`, `${seconds % 60}s`].filter(Boolean).join(" ");
}

export function TimedPaymentDetail({address}: {address: string}) {
  const {connection} = useConnection();
  const {publicKey, connected, sendTransaction} = useWallet();
  const [row, setRow] = useState<{escrow: LiveEscrow; clock: number; readAt: number; canRelease: boolean}>();
  const [readError, setReadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [localTime, setLocalTime] = useState(Date.now);
  const [revision, setRevision] = useState(0);
  const [receipts, setReceipts] = useState<{action: Action; signature: string}[]>([]);
  const pending = useRef(false);

  useEffect(() => {
    const program = devnetProgram;
    if (!program) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [network, account, clock] = await Promise.all([
          connection.getGenesisHash(),
          connection.getAccountInfo(new PublicKey(address), "confirmed"),
          connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"),
        ]);
        if (network !== devnetGenesis || !account?.owner.equals(program!) || !clock || clock.data.length < 40) {
          throw Error("This timed escrow could not be read on Devnet.");
        }
        const escrow = storedEscrow(new PublicKey(address), account.data);
        if (!escrow.terms) throw Error("This escrow has no delivery window.");
        const policy = await connection.getAccountInfo(policyAddress(program!, escrow.payer), "confirmed");
        if (active) {
          const readAt = Date.now();
          setLocalTime(readAt);
          setRow({escrow, clock:Number(clock.data.readBigInt64LE(32)), readAt, canRelease:((policy?.data[1] ?? 0) & 6) === 2});
          setReadError("");
        }
      } catch (error) {
        if (active) setReadError(error instanceof Error ? error.message : "Could not read Devnet.");
      } finally {
        if (active) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    const ticker = setInterval(() => setLocalTime(Date.now()), 1000);
    return () => {active = false; clearTimeout(timer); clearInterval(ticker);};
  }, [address, connection, revision]);

  async function submit(action: Action) {
    const program = devnetProgram;
    if (!publicKey || !connected || !row || !program || pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("Review and sign in your wallet.");
    try {
      const tx = action === "release"
        ? manageEscrow(program, publicKey, row.escrow, "release")
        : manageTimedEscrow(program, publicKey, row.escrow, action as TimedAction);
      const signature = await confirmDevnetTransaction(connection, program, tx, publicKey, sendTransaction, () => {});
      setReceipts(current => [...current, {action, signature}]);
      setMessage("Transaction confirmed on Devnet.");
      void fetch("/api/devnet/timeline", {
        method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({signature}), keepalive:true,
      }).catch(() => {});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The transaction could not finish.");
    } finally {
      pending.current = false;
      setBusy(false);
      setRevision(value => value + 1);
    }
  }

  const escrow = row?.escrow;
  const terms = escrow?.terms;
  const now = row?.clock ?? 0;
  const estimated = row ? now + Math.max(0, Math.floor((localTime - row.readAt) / 1000)) : 0;
  const reviewEnd = terms?.deliveredAt ? terms.deliveredAt + terms.reviewWindowSecs : null;
  const owner = connected ? publicKey : null;
  const buttons: Action[] = [];
  if (escrow && terms && owner && !readError) {
    if (owner.equals(escrow.recipient)) {
      if (escrow.status === 1 && now <= terms.deliveryDeadline) buttons.push("deliver");
      if (escrow.status === 5 && reviewEnd !== null && now >= reviewEnd) buttons.push("claim");
    }
    if (owner.equals(escrow.payer)) {
      if ((escrow.status === 1 || escrow.status === 5) && row?.canRelease) buttons.push("release");
      if (escrow.status === 1 && now > terms.deliveryDeadline) buttons.push("refund");
      if (escrow.status === 5 && terms.arbiter && reviewEnd !== null && now < reviewEnd) buttons.push("dispute");
    }
    if (escrow.status === 6 && terms.arbiter?.equals(owner)) buttons.push("resolveRelease", "resolveRefund");
  }

  return <main className="app-main detail-page devnet-page">
    <Link href="/devnet" className="text-link">Back to Devnet</Link>
    <h1>Delivery escrow</h1>
    {!devnetProgram ? <p role="status">Ava’s Devnet program is unconfigured.</p>
      : readError ? <p role="status">{readError}</p>
      : !escrow && <p role="status">Reading the escrow from Devnet…</p>}
    {escrow && terms && <>
      <h2>{formatBaseUnits(escrow.amount)} test USDC · {describeEscrow(escrow)}</h2>
      <p>{displayCondition(escrow.condition)}</p>
      <p className="wrap-address">Payer {escrow.payer.toBase58()}</p>
      <p className="wrap-address">Recipient {escrow.recipient.toBase58()}</p>
      {terms.arbiter && <p className="wrap-address">Arbiter {terms.arbiter.toBase58()}</p>}
      <a className="text-link" href={explorer("address", address)} target="_blank" rel="noreferrer">Escrow on Solana Explorer</a>
      <section>
        <h2>Delivery and review</h2>
        <ol className="judge-timeline">
          <li>Delivery due {new Date(terms.deliveryDeadline * 1000).toLocaleString()}
            {escrow.status === 1 && ` · ${estimated > terms.deliveryDeadline ? "Delivery window ended" : remaining(terms.deliveryDeadline, estimated) + " left"}`}
          </li>
          <li>{terms.deliveredAt ? `Delivery marked ${new Date(terms.deliveredAt * 1000).toLocaleString()}` : `Review starts when delivery is marked (${terms.reviewWindowSecs.toLocaleString()} seconds)`}</li>
          {reviewEnd !== null && <li>Review ends {new Date(reviewEnd * 1000).toLocaleString()}
            {escrow.status === 5 && ` · ${now >= reviewEnd ? "Claim available" : remaining(reviewEnd, estimated) + " left"}`}
          </li>}
          {escrow.status === 6 && <li>Funds are frozen until the arbiter signs a release or refund.</li>}
        </ol>
        {!connected && <p>Connect the payer, recipient, or arbiter wallet to act.</p>}
        {buttons.length > 0 && <div className="action-list">
          {buttons.map(action => <button className="button glass" key={action} disabled={busy} onClick={() => void submit(action)}>{actions[action]}</button>)}
        </div>}
        {message && <p role="status">{message}</p>}
        <StreamTimeline escrow={address} receipts={receipts}/>
      </section>
    </>}
  </main>;
}
