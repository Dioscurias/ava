"use client";

import {EscrowHistory} from "../../../components/escrow-history";
import {committed, money} from "../../../lib/payments";
import {useWorkspace} from "../../../components/workspace";

export default function ActivityPage() {
  const {state, ready} = useWorkspace();
  const held = committed(state);
  return <main className="app-main detail-page activity-page">
    <h1>Activity</h1>
    {ready ? <>
    <dl className="activity-balance" aria-label="Simulation balance">
      <div><dt>Available to hold</dt><dd>{money(Math.max(0, state.limit - held))} <small>USDC</small></dd></div>
      <div><dt>Held in escrow</dt><dd>{money(held)} <small>USDC</small></dd></div>
      <div><dt>Workspace limit</dt><dd>{money(state.limit)} <small>USDC</small></dd></div>
    </dl>
    <EscrowHistory escrows={state.escrows}/>
    </> : <p role="status">Loading escrow activity…</p>}
  </main>;
}
