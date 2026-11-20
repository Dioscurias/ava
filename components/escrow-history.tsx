"use client";

import Link from "next/link";
import {ArrowUpRight} from "lucide-react";
import {useId, useState} from "react";
import {StatusBadge} from "./workspace";
import {conditionOutcome, money, type Escrow} from "../lib/payments";

const filters = ["All", "Met", "Pending", "Unmet", "Completed"] as const;
type Filter = (typeof filters)[number];
const titles = {All: "All transactions", Met: "Ready to release", Pending: "Pending", Unmet: "Not met / cancelled", Completed: "Completed"};
const dateFormat = new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"});

export function EscrowHistory({escrows}: {escrows: Escrow[]}) {
  const [filter, setFilter] = useState<Filter>("All");
  const resultsId = useId();
  const groups: Record<Filter, Escrow[]> = {All: [...escrows], Met: [], Pending: [], Unmet: [], Completed: []};
  for (const escrow of escrows) {
    groups[escrow.status === "Completed" ? "Completed" : escrow.status === "Cancelled" ? "Unmet" : conditionOutcome(escrow)].push(escrow);
  }
  const visible = groups[filter].slice().sort((left, right) =>
    (right.events.at(-1)?.at ?? "").localeCompare(left.events.at(-1)?.at ?? ""));

  return <section className="activity-ledger" aria-label="Escrow transactions">
    <div className="ledger-filters" role="group" aria-label="Filter escrow transactions">
      {filters.map(option => (
        <button type="button" key={option} aria-pressed={option === filter} aria-controls={resultsId} onClick={() => setFilter(option)}>
          {option === "All" ? "All" : titles[option]} <span>{groups[option].length}</span>
        </button>
      ))}
    </div>
    <div id={resultsId}>
      {visible.length ? <table className="ledger-table">
        <caption className="sr-only">{titles[filter]}</caption>
        <thead><tr><th scope="col" className="ledger-date">Updated</th><th scope="col">Recipient</th><th scope="col" className="ledger-amount">Amount</th><th scope="col">Status</th></tr></thead>
        <tbody>{visible.map(escrow => {
          const event = escrow.events.at(-1);
          const date = Date.parse(event?.at ?? "");
          return <tr key={escrow.id}>
            <td className="ledger-date">{Number.isFinite(date) ? <time dateTime={event?.at}>{dateFormat.format(date)}</time> : "—"}</td>
            <td className="ledger-recipient">
              <Link href={`/payments/${escrow.id}`}>{escrow.recipient}<ArrowUpRight size={12} aria-hidden="true"/></Link>
              {event && <p>{event.label}</p>}
            </td>
            <td className="ledger-amount">{money(escrow.amount)} <small>USDC</small></td>
            <td className="ledger-status"><StatusBadge status={escrow.status}/></td>
          </tr>;
        })}</tbody>
      </table> : <p className="ledger-empty" role="status">No transactions for this filter.</p>}
    </div>
  </section>;
}
