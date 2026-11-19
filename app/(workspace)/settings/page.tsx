"use client";
import {useState} from "react";
import {AudioLines, CirclePause, ShieldCheck} from "lucide-react";
import {committed, money} from "../../../lib/payments";
import {useWorkspace} from "../../../components/workspace";

export default function SettingsPage() {
  const {state, setState, ready} = useWorkspace();
  const [limit, setLimit] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  function save(event: React.FormEvent) {
    event.preventDefault();
    const value = limit ?? (state.limit / 100).toFixed(2);
    const cents = /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : -1;
    if (!Number.isSafeInteger(cents) || cents < committed(state)) {setMessage(`Enter a valid limit of at least ${money(committed(state))} USDC to cover committed payments.`); return;}
    setState(current => ({...current, limit:cents}));
    setLimit(null);
    setMessage("Workspace spending limit saved.");
  }
  const toggles = [
    {key:"allowHold", title:"Fund escrows", body:"Allow new holds and additions to open escrows."},
    {key:"allowRelease", title:"Release funds", body:"Allow confirmed releases and early approvals."},
    {key:"microphone", title:"Microphone", body:"Enable dictation in the agent workspace."},
    {key:"voice", title:"Spoken replies", body:"Read Ava’s replies aloud automatically."}
  ] as const;
  return <main className="app-main detail-page"><h1>Settings</h1><div className="settings-list">
  <section className="panel detail-card"><h2><ShieldCheck size={20}/> Spending limit</h2><p>Total USDC the demo workspace can hold or release. Cancelling an escrow restores that capacity.</p><form className="settings-form" onSubmit={save}><label>Workspace limit (USDC)<input required value={limit ?? (state.limit / 100).toFixed(2)} onChange={e => {setLimit(e.target.value); setMessage("");}} inputMode="decimal"/></label><button className="button primary" disabled={!ready}>Save limit</button></form>{message && <p role="status">{message}</p>}</section>
  <section className="panel detail-card"><h2><AudioLines size={20}/> Permissions and voice</h2>{toggles.map(toggle => <label className="toggle" key={toggle.key}><span><strong>{toggle.title}</strong><small>{toggle.body}</small></span><input type="checkbox" role="switch" disabled={!ready} checked={state[toggle.key]} onChange={e => {const checked = e.target.checked; setState(current => ({...current, [toggle.key]:checked}));}}/></label>)}</section>
  <section className="panel detail-card pause-card"><h2><CirclePause size={20}/> Emergency pause</h2><p>Block funding and releases across the workspace. You can still review or cancel existing escrows.</p><button className="button glass" disabled={!ready} onClick={() => setState(current => ({...current, paused:!current.paused}))}>{state.paused ? "Resume agent" : "Pause agent"}</button></section>
  </div></main>;
}
