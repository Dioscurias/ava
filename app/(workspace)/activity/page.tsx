"use client";

import {EscrowHistory} from "../../../components/escrow-history";
import {useWorkspace} from "../../../components/workspace";

export default function ActivityPage() {
  const {state} = useWorkspace();
  return <main className="app-main detail-page">
    <h1>Activity</h1>
    <EscrowHistory escrows={state.escrows}/>
  </main>;
}
