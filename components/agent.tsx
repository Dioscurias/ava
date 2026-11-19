"use client";
import Link from "next/link";
import Image from "next/image";
import {useRouter} from "next/navigation";
import {ReplyVoice, stopReplyVoice} from "./reply-voice";
import {VoiceOrb} from "./voice-orb";
import {useWallet} from "@solana/wallet-adapter-react";
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {motion, useReducedMotion} from "framer-motion";
import {ArrowRight, ArrowUp, AudioLines, ChevronDown, LockKeyhole, Mic, ShieldCheck} from "lucide-react";
import {active, addEscrow, committed, demoInstruction, guard, money, parsePayment, type Draft} from "../lib/payments";
import {StatusBadge, useWorkspace} from "./workspace";

type Recognition = {
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: {results: ArrayLike<ArrayLike<{transcript: string}>>}) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type Turn = {id: string; prompt: string; reply: string; draft?: Draft; escrow?: string};
const prompts = [
  {label:"Hold a payment", value:demoInstruction},
  {label:"Check payment status", value:"What payments are pending?"},
  {label:"Review my limits", value:"What can you spend?"},
  {label:"Get receiving details", value:"How do I receive USDC?"},
];

export function Agent({demo, intro = false, elevenLabs = false}: {demo: boolean; intro?: boolean; elevenLabs?: boolean}) {
  const router = useRouter();
  const {state, setState, ready, openingPrompt} = useWorkspace();
  const {publicKey} = useWallet();
  const [leaving, setLeaving] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [input, setInput] = useState(demo ? prompts[0].value : "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<Recognition | null>(null);
  const reduced = useReducedMotion();
  const escrows = state.escrows.filter(active);
  const remaining = Math.max(0, state.limit - committed(state));
  useEffect(() => {if (turns.length > 1) conversationEnd.current?.scrollIntoView({behavior: reduced ? "instant" : "smooth", block:"nearest"});}, [turns, reduced]);
  useEffect(() => () => {
    if (voiceRef.current) {
      voiceRef.current.onend = null;
      voiceRef.current.onresult = null;
      voiceRef.current.onerror = null;
      voiceRef.current.stop();
    }
  }, []);

  const addTurn = useCallback((prompt: string) => {
    const draft = parsePayment(prompt);
    let reply = "For a payment, tell me the amount and recipient. You can also tell me what needs to happen before release.";
    if (draft) reply = "Review the terms before placing funds in escrow.";
    else if (/pending|status|escrows|history|activity/i.test(prompt)) reply = escrows.length ? escrows.map(e => `${e.recipient} · ${money(e.amount)} USDC · ${e.status}. ${e.condition}.`).join("\n") : "There are no open escrows.";
    else if (/limit|spend|allow|permission/i.test(prompt)) reply = `You have ${money(remaining)} USDC available under your ${money(state.limit)} USDC workspace limit. Funding is ${state.allowHold ? "enabled" : "disabled"}, and releases are ${state.allowRelease ? "enabled" : "disabled"}.`;
    else if (/receiv|deposit/i.test(prompt)) reply = publicKey ? `Connected Solana address: ${publicKey.toBase58()}. Incoming transfers are simulated in this workspace.` : "Connect a Solana wallet from the workspace header to see its public address. Incoming transfers are simulated in this workspace.";
    const turn = {id: crypto.randomUUID(), prompt, reply, draft: draft ?? undefined};
    setTurns(previous => [...previous, turn]);
    setInput("");
    setNotice("");
  }, [escrows, publicKey, remaining, state.allowHold, state.allowRelease, state.limit]);

  useEffect(() => {if (intro) router.prefetch("/agent/chat");}, [intro, router]);

  useLayoutEffect(() => {
    if (intro || !ready || !openingPrompt.current) return;
    const prompt = openingPrompt.current;
    openingPrompt.current = "";
    setArriving(true);
    addTurn(prompt);
    window.scrollTo({top: 0, behavior: "instant"});
    headingRef.current?.focus({preventScroll: true});
  }, [addTurn, intro, openingPrompt, ready]);

  function send(prompt: string) {
    const instruction = prompt.trim().slice(0, 600);
    if (!instruction || leaving) return;
    if (intro) {
      openingPrompt.current = instruction;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) router.push("/agent/chat", {scroll: false});
      else setLeaving(true);
    } else {
      addTurn(instruction);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (voiceRef.current) {
      voiceRef.current.onresult = null;
      voiceRef.current.onend = null;
      voiceRef.current.stop();
      voiceRef.current = null;
      setListening(false);
    }
    send(input);
  }

  function confirm(turn: Turn) {
    if (!turn.draft || turn.escrow) return;
    const issue = guard(state, turn.draft.amount);
    if (issue) {setNotice(issue); return;}
    const id = "AL-" + crypto.randomUUID().slice(0, 8).toUpperCase();
    const draft = turn.draft;
    setState(current => addEscrow(current, draft, id));
    setTurns(previous => previous.map(item => item.id === turn.id ? {...item, escrow:id} : item));
    setNotice("");
  }

  function dictate() {
    if (listening) {voiceRef.current?.stop(); return;}
    const browser = window as Window & {SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition};
    const Engine = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Engine) {setNotice("Voice input is unavailable in this browser. You can still type an instruction."); return;}
    stopReplyVoice();
    const recognition = new Engine();
    voiceRef.current = recognition;
    recognition.lang = "en-US";
    let transcript = "";
    recognition.onresult = event => {
      transcript = event.results[0]?.[0]?.transcript ?? "";
    };
    recognition.onend = () => {
      setListening(false);
      voiceRef.current = null;
      if (transcript) send(transcript);
    };
    recognition.onerror = () => {
      transcript = "";
      setListening(false);
      setNotice("Voice input stopped. Check your microphone permissions or type your instruction.");
    };
    setNotice("");
    try {recognition.start(); setListening(true);} catch {setNotice("Could not start voice input.");}
  }

  const suggestions = <div className="suggestions">{prompts.map(prompt => <button key={prompt.label} onClick={() => {
    setInput(prompt.value);
    inputRef.current?.focus();
  }}>{prompt.label}<ArrowRight size={14}/></button>)}</div>;
  const composer = (
      <div className="composer-wrap">
        {notice && <p className="notice" role="status">{notice}</p>}
        <form className="composer" onSubmit={submit}>{!intro && <VoiceOrb listening={listening}/>}<input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} maxLength={600} aria-label="Payment instruction" placeholder="Tell Ava what to do…"/>{state.voice && <button className="icon-button dictation-control" type="button" title="Dictate an instruction" aria-label={listening ? "Stop dictation" : "Start dictation"} aria-pressed={listening} onClick={dictate}>{listening ? <AudioLines size={20}/> : <Mic size={19}/>}<span>{listening ? "Stop" : "Speak"}</span></button>}<button type="submit" className="send" aria-label="Send instruction" disabled={!input.trim() || leaving}><ArrowUp size={20}/></button></form>
        <p className="composer-caption" role="status">{listening ? "Listening…" : ""}</p>
      </div>
  );

  if (intro) return <main className={`app-main agent-intro${leaving ? " agent-intro-leaving" : ""}`}>
    <div className="intro-title"><h1>What should move?</h1></div>
    <div className="intro-visual" onAnimationEnd={event => {
      if (leaving && event.target === event.currentTarget && event.animationName === "agent-orb-send") {
        router.push("/agent/chat", {scroll: false});
      }
    }}><VoiceOrb listening={listening} processing={leaving} large/></div>
    <section className="intro-controls" aria-label="Start a conversation">
      {suggestions}
      {composer}
    </section>
  </main>;

  return <main className={`app-main agent-grid${arriving ? " agent-chat-arriving" : ""}`}>
    <section className="agent-column" aria-label="Agent conversation">
      <div className="agent-top"><div><h1 ref={headingRef} tabIndex={-1}>Ava agent</h1></div></div>
      <div className="conversation">
        {turns.length === 0 && <div className="welcome"><h2>What should move?</h2><p>Tell Ava who to pay and when.</p>{suggestions}</div>}
        <div className="turns" aria-live="polite">{turns.map(turn => <motion.article key={turn.id} initial={reduced || (arriving && turn === turns[0]) ? false : {opacity:0, y:8}} animate={{opacity:1,y:0}} className="turn"><p className="user-turn">{turn.prompt}</p><div className="agent-turn"><Image className="reply-orb" src="/ava-reply-orb.webp" alt="" width={20} height={20} unoptimized/><div><div className="reply-heading"><strong>Ava</strong>{state.voice && <ReplyVoice text={turn.draft ? `I’ve drafted ${money(turn.draft.amount)} U.S.D.C. for ${turn.draft.recipient}. Release condition: ${turn.draft.condition}. Review the terms before placing funds in escrow.` : turn.reply} elevenLabs={elevenLabs} autoPlay={!listening && turn.id === turns.at(-1)?.id}/>}</div><p>{turn.reply}</p>{turn.draft && <div className="draft"><h3>{money(turn.draft.amount)} <small>USDC</small></h3><dl><div><dt>Recipient</dt><dd>{turn.draft.recipient}</dd></div><div><dt>Release condition</dt><dd>{turn.draft.condition}</dd></div></dl>{turn.escrow ? <Link className="text-link" href={`/payments/${turn.escrow}`}>View demo escrow <ArrowRight size={15}/></Link> : <button className="button primary" disabled={!ready} onClick={() => confirm(turn)}>Confirm demo escrow <LockKeyhole size={14}/></button>}</div>}</div></div></motion.article>)}</div>
        <div ref={conversationEnd}/>
      </div>
      {composer}
    </section>
    <aside className="agent-side">
      <section className="panel">
        <button className="panel-heading" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen} aria-controls="active-escrows"><span><LockKeyhole size={16}/> Active escrows <small>{escrows.length}</small></span><ChevronDown size={17} className={panelOpen ? "" : "-rotate-90"}/></button>
        {panelOpen && <div id="active-escrows">{escrows.length ? escrows.map(e => <Link className="escrow-row" key={e.id} href={`/payments/${e.id}`}><div><strong>{e.recipient}</strong><span>{money(e.amount)} USDC</span></div><StatusBadge status={e.status}/><p>{e.condition}</p></Link>) : <p className="panel-empty">No funds are currently held. Confirm a payment to see it here.</p>}</div>}
      </section>
      <section className="panel limit-panel"><div className="panel-heading"><span><ShieldCheck size={17}/> Spending limits</span></div><div className="limit-details"><strong>{money(remaining)} <small>USDC</small></strong><p>Available of {money(state.limit)} USDC</p><progress max={state.limit || 1} value={Math.min(committed(state), state.limit)} aria-label="Workspace spending limit used"/><p>Funding {state.allowHold ? "enabled" : "disabled"} · Releases {state.allowRelease ? "enabled" : "disabled"}</p><Link href="/settings" className="text-link">Manage permissions <ArrowRight size={14}/></Link></div></section>
    </aside>
  </main>;
}
