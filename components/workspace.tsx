"use client";
import Link from "next/link";
import {usePathname, useSearchParams} from "next/navigation";
import {Activity, CircleHelp, MessageSquare, Settings2, Wallet} from "lucide-react";
import {ConnectionProvider, WalletProvider, useWallet} from "@solana/wallet-adapter-react";
import {clusterApiUrl} from "@solana/web3.js";
import {Suspense, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState} from "react";
import {continueWithGoogle, signOutAccount} from "../app/login/actions";
import {applyWorkspaceOperation, type WorkspaceOperation} from "../lib/workspace-operations";
import {Brand} from "./brand";
import {initial, type State, type Status} from "../lib/payments";

type Account = {id:string; name:string; image?:string | null};
const emptyWorkspace = {...initial, escrows:[]};
const guestStorageKey = "astra-light-workspace-v1";
const Store = createContext<{state: State; update: (operation: WorkspaceOperation) => Promise<void>; ready: boolean; saving: boolean; openingPrompt: React.RefObject<string>; openingVoice: React.RefObject<boolean>} | null>(null);
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
  return <details className="wallet-menu"><summary className="button glass"><Wallet size={15}/><span>{address ? `${address.slice(0,4)}…${address.slice(-4)}` : "Connect wallet"}</span></summary>
    <div className="wallet-pop"><strong>Solana wallet</strong><p>Wallet connection is optional in demo mode.</p>{address && <p className="break-all select-all font-mono" title="Solana public address">{address}</p>}
      {connected ? <button className="button glass" onClick={() => void disconnect().catch(() => setError("Could not disconnect."))}>Disconnect</button> :
        wallets.filter(w => w.readyState === "Installed" || w.readyState === "Loadable").map(w => <button className="button glass" key={w.adapter.name} disabled={connecting} onClick={() => {setError(""); setChosen(w.adapter.name); select(w.adapter.name);}}>{w.adapter.name}</button>)}
      {!connected && !wallets.some(w => w.readyState === "Installed" || w.readyState === "Loadable") && <p>Open this app in a browser with a Solana wallet installed.</p>}{error && <p role="alert">{error}</p>}
    </div></details>;
}

function PaymentMode({devnet}: {devnet: boolean}) {
  return <nav className="mode-switch" aria-label="Payment mode">
    <Link href="/agent" aria-current={!devnet ? "true" : undefined}>Simulation</Link>
    <Link href="/devnet" aria-current={devnet ? "true" : undefined}>Devnet</Link>
  </nav>;
}

function CurrentPaymentMode({path}: {path: string}) {
  const mode = useSearchParams();
  return <PaymentMode devnet={path === "/devnet" || (path === "/agent/chat" && mode.get("mode") === "devnet")}/>;
}

export function Workspace({children, account}: {children: React.ReactNode; account: Account | null}) {
  const path = usePathname();
  const workspaceBody = useRef<HTMLDivElement>(null);
  const previousPath = useRef(path);

  useLayoutEffect(() => {
    const from = previousPath.current;
    previousPath.current = path;
    if (from === path || (from === "/agent" && path === "/agent/chat")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const page = workspaceBody.current?.querySelector<HTMLElement>(".app-main");
    const transition = page?.animate?.(
      [{opacity: 0.7, transform: "translateY(4px)"}, {opacity: 1, transform: "translateY(0)"}],
      {duration: 180, easing: "cubic-bezier(.2,.7,.3,1)"},
    );
    return () => transition?.cancel();
  }, [path]);
  const [state, setState] = useState(account ? emptyWorkspace : initial);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const openingPrompt = useRef("");
  const openingVoice = useRef(false);
  const accountId = account?.id;
  const install = useCallback((next: State) => {
    current.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    if (!accountId) {
      try {
        const saved = localStorage.getItem(guestStorageKey);
        if (saved) install({...initial, ...JSON.parse(saved)});
      } catch { /* Keep the demo usable when storage is unavailable. */ }
      setReady(true);
      return;
    }
    const controller = new AbortController();
    setLoadError("");
    void fetch("/api/workspace", {cache:"no-store", signal:controller.signal, headers:{"x-ava-account":accountId}})
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (controller.signal.aborted) return;
        install(body.state);
        setReady(true);
      })
      .catch(error => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load your saved workspace.");
      });
    return () => controller.abort();
  }, [accountId, install, revision]);

  useEffect(() => {
    if (ready && !accountId) try {localStorage.setItem(guestStorageKey, JSON.stringify(state));} catch { /* Storage is optional. */ }
  }, [state, ready, accountId]);

  const update = useCallback(async (operation: WorkspaceOperation) => {
    if (!ready) throw new Error("The workspace is still loading.");
    if (!accountId) {
      install(applyWorkspaceOperation(current.current, operation));
      return;
    }
    if (savingRef.current) throw new Error("Wait for the current workspace change to finish.");
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/workspace", {
        method:"POST", headers:{"content-type":"application/json", "x-ava-account":accountId},
        signal:AbortSignal.timeout(15_000), body:JSON.stringify(operation),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The workspace could not be saved.");
      install(body.state);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [accountId, install, ready]);
  const links = [{href:"/agent", label:"Agent", icon:MessageSquare},{href:"/activity",label:"Activity",icon:Activity},{href:"/settings",label:"Settings",icon:Settings2}];
  return <Store.Provider value={{state, update, ready, saving, openingPrompt, openingVoice}}><ConnectionProvider endpoint={endpoint}><WalletProvider wallets={adapters}><div className="workspace">
    <header className="app-header">
      <Brand/>
      <nav className="workspace-nav" aria-label="Workspace">
        {links.map(({href, label, icon: Icon}) => (
          <Link key={href} href={href} aria-current={path === href || (href === "/agent" && path.startsWith("/agent/")) || (href === "/activity" && path.startsWith("/payments")) ? "page" : undefined}>
            <Icon size={16}/>{label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<PaymentMode devnet={path === "/devnet"}/>}>
        <CurrentPaymentMode path={path}/>
      </Suspense>
      <div className="account-controls">
        {account ? <details className="wallet-menu account-menu">
          <summary className="button glass" aria-label={`Account menu for ${account.name}`}>
            {account.image?.startsWith("https://") && <img src={account.image} alt="" width={22} height={22} referrerPolicy="no-referrer"/>}
            <span title={account.name}>{account.name}</span>
          </summary>
          <div className="wallet-pop">
            <Link className="text-link" href="/settings">Settings</Link>
            <form action={signOutAccount}><button className="button glass" disabled={saving}>Sign out</button></form>
          </div>
        </details> : <form action={continueWithGoogle}><button className="button glass" type="submit">Continue with Google</button></form>}
        <WalletMenu/>
      </div>
    </header>
    <div className="workspace-body" ref={workspaceBody}>
    {!account && (path === "/agent/chat" || path === "/activity" || path === "/settings") && <div className="guest-banner"><Link className="text-link" href="/login">Sign in to save your escrows</Link></div>}
    {loadError && <div className="guest-banner" role="alert">{loadError} <button className="text-link" type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {state.paused && <div className="paused-banner" role="status">Agent paused. <Link href="/settings">Manage permissions</Link></div>}
    {children}
    <footer className="app-footer"><CircleHelp size={14}/> {path === "/devnet" ? "Solana Devnet · Test tokens only" : "Simulation mode · No funds move on-chain"}</footer>
    </div>
  </div></WalletProvider></ConnectionProvider></Store.Provider>;
}
