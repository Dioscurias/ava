"use client";
import {StreamHealth} from "../../../components/stream-timeline";
import Link from "next/link";
import {ArrowUpRight} from "lucide-react";
import {money} from "../../../lib/payments";
import {StatusBadge, useWorkspace} from "../../../components/workspace";

export default function ActivityPage() {
  const {state} = useWorkspace();
  return <main className="app-main detail-page"><h1>Activity</h1><StreamHealth/><section className="panel activity-list" aria-label="Payment history">
    {!state.escrows.length && <p className="panel-empty">Payment activity will appear here.</p>}
    {state.escrows.map(e => <Link href={`/payments/${e.id}`} key={e.id} className="activity-row"><div><strong>{e.recipient}</strong><p>{e.events.at(-1)?.label}</p></div><span>{money(e.amount)} USDC</span><StatusBadge status={e.status}/><ArrowUpRight size={16}/></Link>)}
  </section></main>;
}
