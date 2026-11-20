"use client";
import Link from "next/link";
import {useState} from "react";
import {ArrowLeft, Check, LockKeyhole} from "lucide-react";
import {active, displayCondition, guard, money, type Action} from "../lib/payments";
import {StatusBadge, useWorkspace} from "./workspace";

export function PaymentDetail({id}: {id: string}) {
  const {state, update, ready, saving} = useWorkspace();
  const escrow = state.escrows.find(e => e.id === id);
  const [pending, setPending] = useState<Action | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  if (!escrow) return <main className="app-main detail-page"><h1>{ready ? "Escrow unavailable" : "Loading escrow…"}</h1><Link className="text-link" href="/activity">Return to activity</Link></main>;
  const actions: {id: Action; label: string}[] = [];
  if (!state.paused && escrow.status !== "Paused") {
    if (state.allowRelease) actions.push({id:"release", label:escrow.status === "Ready to release" ? "Release funds" : "Approve early"});
    if (escrow.status !== "Ready to release") actions.push({id:"verify", label:"Mark condition met"});
    if (state.allowHold) actions.push({id:"add", label:"Add funds"});
    actions.push({id:"pause", label:"Pause escrow"});
  }
  if (escrow.status === "Paused" && !state.paused) actions.push({id:"resume", label:"Resume escrow"});
  actions.push({id:"cancel", label:"Cancel escrow"});
  const selected = actions.find(action => action.id === pending);
  const explanations: Record<Action, string> = {
    release: escrow.status === "Ready to release" ? "This records a release to the recipient in the demo." : "This records a release before the condition has been confirmed.",
    verify:"Record that you checked the release condition. You can then approve the release.",
    add:"Increase the amount held in this demo escrow.",
    pause:"Prevent release and additional funding until you resume this escrow.",
    resume:"Reopen this escrow for condition review.",
    cancel:"Close this escrow and restore the held amount to your demo spending capacity."
  };

  async function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!pending || !selected) return;
    const cents = /^\d+(?:\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
    if (pending === "add") {
      const issue = guard(state, cents);
      if (issue) {setError(issue); return;}
    }
    try { await update({type:"escrow", id, action:pending, amount:cents}); }
    catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the escrow.");
      return;
    }
    setPending(null);
    setError("");
    setAmount("");
  }

  return <main className="app-main detail-page">
    <Link href="/activity" className="text-link back"><ArrowLeft size={15}/> Activity</Link>
    <h1>{escrow.recipient}</h1>
    <div className="detail-grid"><section className="panel detail-card"><StatusBadge status={escrow.status}/><h2>{money(escrow.amount)} <small>USDC</small></h2><div className="condition"><LockKeyhole size={19}/><div><strong>Release condition</strong><p>{displayCondition(escrow.condition)}</p></div></div>
    {active(escrow) && <div className="action-list">{actions.map((action, index) => <button key={action.id} disabled={!ready || saving} className={`button ${index === 0 && action.id === "release" ? "primary" : "glass"}`} onClick={() => {setPending(action.id); setError("");}}>{action.label}</button>)}</div>}
    {selected && pending && <form className="action-form" onSubmit={apply}><strong>{selected.label}</strong><p>{explanations[pending]}</p>{pending === "add" && <label>Amount in USDC<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" autoFocus required/></label>}{error && <p role="alert">{error}</p>}<div className="action-list"><button className="button primary" disabled={saving}>Confirm</button><button type="button" className="button glass" onClick={() => setPending(null)}>Go back</button></div></form>}</section>
    <section className="panel detail-card timeline"><h3>Timeline</h3><ol>{escrow.events.map((event,index) => <li key={index}><Check size={15}/><div><strong>{event.label}</strong><time dateTime={event.at}>{new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(event.at))} UTC</time></div></li>)}</ol></section></div>
  </main>;
}
