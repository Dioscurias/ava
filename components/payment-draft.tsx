"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { money, type Draft } from "../lib/payments";
import { defaultCondition, type DraftField, type DraftMemory } from "../lib/draft-memory";
import type { MarketChoice } from "../lib/gemini-condition";

type Props = {
  memory: DraftMemory;
  highlighted: DraftField[];
  escrow?: string;
  canConfirm: boolean;
  confirm: () => void;
  undo: () => void;
  edit: (draft: Partial<Draft>) => void;
  choose: (index: number) => void;
  market?: {choices?: MarketChoice[]; selected?: MarketChoice; notice: string};
  chooseMarket: (market: MarketChoice) => void;
};

export function PaymentDraft({memory, highlighted, escrow, canConfirm, confirm, undo, edit, choose, market, chooseMarket}: Props) {
  const {current, choices, history} = memory;
  const [editing, setEditing] = useState(false);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const amount = String(values.get("amount")).trim();
    const recipient = String(values.get("recipient")).trim();
    const condition = String(values.get("condition")).trim() || defaultCondition;
    edit({amount: amount ? Math.round(Number(amount) * 100) : undefined, recipient: recipient || undefined, condition});
    setEditing(false);
  }

  if (!choices && !current.amount && !current.recipient && !current.condition) return null;
  const selected = market?.selected;
  return <section className="draft payment-draft" aria-label="Current payment draft">
    <h3>{current.status === "confirmed" ? "Confirmed payment" : "Payment draft"}</h3>
    <dl>
      <div data-draft-highlight={highlighted.includes("amount")}><dt>Amount</dt><dd>{current.amount ? `${money(current.amount)} USDC` : "Amount needed"}</dd></div>
      <div data-draft-highlight={highlighted.includes("recipient")}><dt>Recipient</dt><dd>{current.recipient || "Recipient needed"}</dd></div>
      <div data-draft-highlight={highlighted.includes("condition")}><dt>Release condition</dt><dd>{current.condition ?? defaultCondition}</dd></div>
      {selected && <>
        <div><dt>Gemini market</dt><dd>{selected.title} · {selected.label}</dd></div>
        <div><dt>Release outcome</dt><dd>{selected.side.toUpperCase()}</dd></div>
        <div><dt>Current YES bid / ask</dt><dd>{[selected.yesBid, selected.yesAsk].map(price => price === null ? "Unavailable" : `${(price * 100).toFixed(1)}%`).join(" / ")}</dd></div>
        <div><dt>Expiry</dt><dd>{new Date(selected.expiryDate).toLocaleString()}</dd></div>
      </>}
    </dl>
    {choices && <div className="draft-actions" aria-label="Choose a recipient">
      {choices.map((choice, index) => <button type="button" className="button glass" key={index} onClick={() => choose(index)}>
        {choice.amount ? `${money(choice.amount)} USDC to ` : ""}{choice.recipient}
      </button>)}
    </div>}
    {market?.notice && <p role="status">{market.notice}</p>}
    {market?.choices?.map(choice => <button type="button" className="button glass" key={choice.instrumentSymbol} onClick={() => chooseMarket(choice)}>
      {choice.title} · {choice.label} · {new Date(choice.expiryDate).toLocaleString()}
    </button>)}
    {selected && <p>Ava checks this against Gemini&apos;s public settlement data. Preview only.</p>}
    {escrow ? <Link className="text-link" href={`/payments/${escrow}`}>View demo escrow</Link> : <>
      {editing && <form className="draft-edit" onSubmit={save}>
        <label>Amount in USDC<input autoFocus name="amount" type="number" min="0.01" max="90071992547409" step="0.01" defaultValue={current.amount && current.amount / 100}/></label>
        <label>Recipient<input name="recipient" maxLength={100} defaultValue={current.recipient}/></label>
        <label>Release condition<input name="condition" maxLength={500} defaultValue={current.condition}/></label>
        <div className="draft-actions">
          <button className="button primary" type="submit">Save changes</button>
          <button className="button glass" type="button" onClick={() => setEditing(false)}>Cancel edit</button>
        </div>
      </form>}
      {!editing && <div className="draft-actions">
        <button className="button glass" type="button" onClick={() => setEditing(true)}>Edit</button>
        <button className="button glass" type="button" disabled={!choices && !history.length} onClick={undo}>Undo</button>
        {current.status === "ready" && !market && <button className="button primary" type="button" disabled={!canConfirm} onClick={confirm}>Confirm demo escrow</button>}
      </div>}
    </>}
  </section>;
}
