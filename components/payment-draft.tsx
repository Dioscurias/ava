"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { scheduledCondition } from "../lib/release-schedule";
import { money, type Draft } from "../lib/payments";
import { defaultCondition, type DraftField, type DraftMemory } from "../lib/draft-memory";
import type {MarketChoice} from "../lib/gemini-condition";

const formatExpiry = (date: string) => new Date(date).toLocaleString(undefined, {
  dateStyle: "medium", timeStyle: "long",
});
const formatPrice = (price: number | null) => price === null ? "Unavailable" : `${+(price * 100).toFixed(2)}¢`;

type Props = {
  memory: DraftMemory;
  highlighted: DraftField[];
  escrow?: string;
  canConfirm: boolean;
  paused: boolean;
  availableLimit?: number;
  devnet?: boolean;
  devnetReceipt?: string;
  confirm: () => void;
  undo: () => void;
  edit: (draft: Partial<Draft>) => void;
  choose: (index: number) => void;
  market?: {choices?: MarketChoice[]; selected?: MarketChoice; notice: string};
  chooseMarket: (market: MarketChoice) => void;
};

export function PaymentDraft({memory, highlighted, escrow, canConfirm, paused, availableLimit, devnet, devnetReceipt, confirm, undo, edit, choose, market, chooseMarket}: Props) {
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
  const terms = choices?.[0] ?? current;
  const schedule = terms.condition && scheduledCondition(terms.condition);
  return <section className="draft payment-draft" aria-label="Current payment draft">
    <h3>{current.status === "confirmed" ? "Confirmed payment" : "Payment draft"}</h3>
    <dl>
      <div data-draft-highlight={highlighted.includes("amount")}><dt>Amount</dt><dd>{terms.amount ? `${money(terms.amount)} USDC` : "Amount needed"}</dd></div>
      <div data-draft-highlight={highlighted.includes("recipient")}><dt>Recipient</dt><dd>{choices ? "Choose a recipient" : current.recipient || "Recipient needed"}</dd></div>
      <div data-draft-highlight={highlighted.includes("condition")}><dt>Release condition</dt><dd>{terms.condition ?? defaultCondition}</dd></div>
      {schedule && <div><dt>Automatic release</dt><dd>{schedule.text}</dd></div>}
      {selected && <>
        <div><dt>Gemini market</dt><dd>{selected.title} · {selected.label}</dd></div>
        <div><dt>Release outcome</dt><dd>{selected.side.toUpperCase()}</dd></div>
        <div><dt>Contract ID</dt><dd>{selected.instrumentSymbol}</dd></div>
        <div><dt>Buy YES (ask)</dt><dd>{formatPrice(selected.yesAsk)}</dd></div>
        <div><dt>Sell YES (bid)</dt><dd>{formatPrice(selected.yesBid)}</dd></div>
        <div><dt>Expires</dt><dd><time dateTime={selected.expiryDate}>{formatExpiry(selected.expiryDate)}</time></dd></div>
      </>}
    </dl>
    {choices && <div className="draft-actions" aria-label="Choose a recipient">
      {choices.map((choice, index) => <button type="button" className="button glass" key={index} onClick={() => choose(index)}>
        {choice.amount ? `${money(choice.amount)} USDC to ` : ""}{choice.recipient}
      </button>)}
    </div>}
    {current.status !== "confirmed" && paused && <p role="status">Ava is paused. <Link className="text-link" href="/settings">Resume in Settings</Link> to confirm.</p>}
    {current.status !== "confirmed" && availableLimit !== undefined && <div role="status">
      <p><strong>Exceeds your available limit of {money(availableLimit)} USDC</strong></p>
      <p>Lower the amount or <Link className="text-link" href="/settings">raise the limit in Settings</Link>.</p>
    </div>}
    {schedule && <p>{devnet
      ? "Scheduled releases are available in Simulation."
      : "After confirmation, Ava releases the demo funds when due while your workspace is open, or when you return. Pause or disable releases to stop an upcoming release."}</p>}
    {market?.notice && <p role="status">{market.notice}</p>}
    {market?.choices?.map(choice => <button type="button" className="button glass" key={choice.instrumentSymbol} onClick={() => chooseMarket(choice)}>
      {choice.title} · {choice.label} · {choice.instrumentSymbol} · {formatExpiry(choice.expiryDate)}
    </button>)}
    {market && <p>Market preview · Gemini quotes and expiry only.</p>}
    {selected && <p>Bid and ask were captured when this contract was selected.</p>}
    {devnetReceipt ? <div className="draft-actions"><a href={devnetReceipt} className="text-link" target="_blank" rel="noreferrer">View funding transaction on Solana Explorer</a>{escrow && <Link className="text-link" href={`/payments/${escrow}`}>Open payment receipt</Link>}</div> : escrow ? <Link className="text-link" href={`/payments/${escrow}`}>View demo escrow</Link> : <>
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
        {current.status === "ready" && !market && !devnet && <button className="button primary" type="button" disabled={!canConfirm} onClick={confirm}>Confirm demo escrow</button>}
      </div>}
    </>}
  </section>;
}
