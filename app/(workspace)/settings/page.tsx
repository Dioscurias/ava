"use client";
import {useState} from "react";
import {AudioLines, CirclePause, ShieldCheck} from "lucide-react";
import {committed, money} from "../../../lib/payments";
import {useWorkspace} from "../../../components/workspace";

export default function SettingsPage() {
  const {state, update, ready, saving} = useWorkspace();
  const [limit, setLimit] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const minimum = committed(state);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const value = limit ?? (state.limit / 100).toFixed(2);
    const cents = /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : -1;
    if (!Number.isSafeInteger(cents) || cents < minimum) {setMessage(`Enter a valid limit of at least ${money(minimum)} USDC to cover active escrows.`); return;}
    if (await change({type:"limit", amount:cents}, "Workspace spending limit saved.")) setLimit(null);
  }
  async function change(operation: Parameters<typeof update>[0], success = "") {
    try {await update(operation); setMessage(success); return true;}
    catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your settings.");
      return false;
    }
  }
  const toggles = [
    {key:"allowHold", title:"Fund escrows", body:"Allow new holds and additions to open escrows."},
    {key:"allowRelease", title:"Release funds", body:"Allow confirmed releases and early approvals."},
    {key:"microphone", title:"Microphone", body:"Enable dictation in the agent workspace."},
    {key:"voice", title:"Spoken replies", body:"Read Ava’s replies aloud automatically."}
  ] as const;
  return <main className="app-main detail-page"><h1>Settings</h1><div className="settings-list">
  <section className="panel detail-card"><h2><ShieldCheck size={20}/> Spending limit</h2><p>Maximum USDC held in active demo escrows. Completed and cancelled escrows free up capacity.</p><form className="settings-form" onSubmit={save}><label>Workspace limit (USDC)<input type="number" min={minimum / 100} step="0.01" aria-describedby="workspace-limit-minimum" required value={limit ?? (state.limit / 100).toFixed(2)} onChange={e => {setLimit(e.target.value); setMessage("");}} inputMode="decimal"/><small id="workspace-limit-minimum">Must be at least {money(minimum)} USDC, the total of your active escrows.</small></label><button className="button primary" disabled={!ready || saving}>Save limit</button></form></section>
  <section className="panel detail-card"><h2><AudioLines size={20}/> Permissions and voice</h2>{toggles.map(toggle => {
    const pausedPermission = state.paused && (toggle.key === "allowHold" || toggle.key === "allowRelease");
    return <label className="toggle" key={toggle.key}><span><strong>{toggle.title}</strong><small>{toggle.body}</small></span><input type="checkbox" role="switch" disabled={!ready || saving || pausedPermission} checked={!pausedPermission && state[toggle.key]} onChange={e => {const checked = e.target.checked; void change({type:"preference", key:toggle.key, value:checked});}}/></label>;
  })}</section>
  <section className="panel detail-card pause-card"><h2><CirclePause size={20}/> Emergency pause</h2><p>Block funding and releases across the workspace. You can still review or cancel existing escrows.</p><button className="button glass" disabled={!ready || saving} onClick={() => void change({type:"preference", key:"paused", value:!state.paused})}>{state.paused ? "Resume agent" : "Pause agent"}</button></section>
  {message && <p role="status">{message}</p>}</div></main>;
}
