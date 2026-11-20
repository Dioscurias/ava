"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {Activity, CircleHelp, MessageSquare, Settings2, Wallet} from "lucide-react";
import {ConnectionProvider, WalletProvider, useWallet} from "@solana/wallet-adapter-react";
import {clusterApiUrl} from "@solana/web3.js";
import {createContext, useContext, useEffect, useRef, useState} from "react";
import {Brand} from "./brand";
import {initial, type State, type Status} from "../lib/payments";

const Store = createContext<{state: State; setState: React.Dispatch<React.SetStateAction<State>>; ready: boolean; openingPrompt: React.RefObject<string>; openingVoice: React.RefObject<boolean>} | null>(null);
export function useWorkspace() {
  const store = useContext(Store);
  if (!store) throw new Error("Workspace provider missing");
  return store;
}
export function StatusBadge({status}: {status: Status}) {
  return <span className="status">{status}</span>;
}

const endpoint = clusterApiUrl("devnet");
const adapters: React.ComponentProps<typeof WalletProvider>["wallets"] = [];
function WalletMenu() {
  const {wallets, select, wallet, connect, disconnect, connected, connecting, publicKey} = useWallet();
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!chosen || wallet?.adapter.name !== chosen) return;
    setChosen(null);
    void connect().catch(() => setError("Connection declined or unavailable."));
  }, [chosen, wallet, connect]);
  const address = publicKey?.toBase58();
  return <details className="wallet-menu"><summary className="button glass"><Wallet size={15}/>{address ? `${address.slice(0,4)}…${address.slice(-4)}` : "Connect wallet"}</summary>
    <div className="wallet-pop"><strong>Solana wallet</strong><p>Wallet connection is optional in demo mode.</p>{address && <p className="break-all select-all font-mono" title="Solana public address">{address}</p>}
      {connected ? <button className="button glass" onClick={() => void disconnect().catch(() => setError("Could not disconnect."))}>Disconnect</button> :
        wallets.filter(w => w.readyState === "Installed" || w.readyState === "Loadable").map(w => <button className="button glass" key={w.adapter.name} disabled={connecting} onClick={() => {setError(""); setChosen(w.adapter.name); select(w.adapter.name);}}>{w.adapter.name}</button>)}
      {!connected && !wallets.some(w => w.readyState === "Installed" || w.readyState === "Loadable") && <p>Open this app in a browser with a Solana wallet installed.</p>}{error && <p role="alert">{error}</p>}
    </div></details>;
}

export function Workspace({children}: {children: React.ReactNode}) {
  const path = usePathname();
  const [state, setState] = useState(initial);
  const [ready, setReady] = useState(false);
  const openingPrompt = useRef("");
  const openingVoice = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("astra-light-workspace-v1");
      if (saved) setState({...initial, ...JSON.parse(saved)});
    } catch { /* Keep the demo usable when storage is unavailable. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) try {localStorage.setItem("astra-light-workspace-v1", JSON.stringify(state));} catch { /* Storage is optional. */ }
  }, [state, ready]);
  const links = [{href:"/agent", label:"Agent", icon:MessageSquare},{href:"/activity",label:"Activity",icon:Activity},{href:"/settings",label:"Settings",icon:Settings2}];
  return <Store.Provider value={{state, setState, ready, openingPrompt, openingVoice}}><ConnectionProvider endpoint={endpoint}><WalletProvider wallets={adapters}><div className="workspace">
    <header className="app-header">
      <Brand/>
      <nav className="workspace-nav" aria-label="Workspace">
        {links.map(({href, label, icon: Icon}) => (
          <Link key={href} href={href} aria-current={path === href || (href === "/agent" && path.startsWith("/agent/")) || (href === "/activity" && path.startsWith("/payments")) ? "page" : undefined}>
            <Icon size={16}/>{label}
          </Link>
        ))}
      </nav>
      <nav className="mode-switch" aria-label="Payment mode">
        <Link href="/agent" aria-current={path !== "/devnet" ? "true" : undefined}>Simulation</Link>
        <Link href="/devnet" aria-current={path === "/devnet" ? "true" : undefined}>Devnet</Link>
      </nav>
      <WalletMenu/>
    </header>
    <div className="workspace-body">
    {state.paused && <div className="paused-banner" role="status">Agent paused. <Link href="/settings">Manage permissions</Link></div>}
    {children}
    <footer className="app-footer"><CircleHelp size={14}/> {path === "/devnet" ? "Solana Devnet · Test tokens only" : "Simulation mode · No funds move on-chain"}</footer>
    </div>
  </div></WalletProvider></ConnectionProvider></Store.Provider>;
}
