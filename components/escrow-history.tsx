import Link from "next/link";
import {ArrowUpRight} from "lucide-react";
import {StatusBadge} from "./workspace";
import {conditionOutcome, money, type Escrow} from "../lib/payments";

const outcomes = ["Met", "Pending", "Unmet", "Completed"] as const;
const titles = {Met: "Condition met / ready to release", Pending: "Pending", Unmet: "Not met / cancelled", Completed: "Completed"};

export function EscrowHistory({escrows}: {escrows: Escrow[]}) {
  const groups: Record<(typeof outcomes)[number], Escrow[]> = {Met: [], Pending: [], Unmet: [], Completed: []};
  for (const escrow of escrows) groups[escrow.status === "Completed" ? "Completed" : escrow.status === "Cancelled" ? "Unmet" : conditionOutcome(escrow)].push(escrow);

  return <div className="activity-groups">
    {outcomes.map(outcome => {
      const heading = `activity-${outcome.toLowerCase()}`;
      const escrows = groups[outcome];
      return <section key={outcome} className="activity-list" aria-labelledby={heading}>
        <h2 id={heading}>{titles[outcome]} <span>{escrows.length}</span></h2>
        {escrows.length === 0 && <p className="panel-empty">No payments in this group.</p>}
        {escrows.map(escrow => <Link href={`/payments/${escrow.id}`} key={escrow.id} className="activity-row">
          <div><strong>{escrow.recipient}</strong><p>{escrow.events.at(-1)?.label}</p></div>
          <span>{money(escrow.amount)} USDC</span>
          <StatusBadge status={escrow.status}/>
          <ArrowUpRight size={16} aria-hidden="true"/>
        </Link>)}
      </section>;
    })}
  </div>;
}
