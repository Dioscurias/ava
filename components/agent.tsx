"use client";
import Link from "next/link";
import Image from "next/image";
import {useRouter} from "next/navigation";
import {ReplyVoice, stopReplyVoice, unlockReplyVoice} from "./reply-voice";
import {VoiceOrb} from "./voice-orb";
import {useWallet} from "@solana/wallet-adapter-react";
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {motion, useReducedMotion} from "framer-motion";
import {ArrowRight, ArrowUp, AudioLines, ChevronDown, LockKeyhole, Mic, ShieldCheck} from "lucide-react";
import {active, addEscrow, committed, demoInstruction, guard, money, type Draft} from "../lib/payments";
import {parseMarketCondition, type MarketChoice} from "../lib/gemini-condition";
import {PaymentDraft} from "./payment-draft";
import {changedFields, chooseDraft, confirmDraft, draftTurn, editDraft, emptyDraft, nextDraftQuestion, readyDraft, type DraftField, type DraftMemory} from "../lib/draft-memory";
import {StatusBadge, useWorkspace} from "./workspace";

type RecognitionResult = ArrayLike<{transcript: string}> & {isFinal: boolean};

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: {results: ArrayLike<RecognitionResult>}) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type Turn = {id: string; prompt: string; reply: string; pending?: boolean};
type Market = {condition: string; choices?: MarketChoice[]; selected?: MarketChoice; notice: string};
const btcPrompt = "Hold 5 USDC for Dave until the next BTC 5-minute round settles up";
const prompts = [
  {label:"Hold a payment", value:demoInstruction},
  {label:btcPrompt, value:btcPrompt},
  {label:"Check payment status", value:"What payments are pending?"},
  {label:"Review my limits", value:"What can you spend?"},
  {label:"Get receiving details", value:"How do I receive USDC?"},
];

export function Agent({demo, intro = false}: {demo: boolean; intro?: boolean}) {
  const router = useRouter();
  const {state, setState, ready, openingPrompt} = useWorkspace();
  const {publicKey} = useWallet();
  const [leaving, setLeaving] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [input, setInput] = useState(demo ? prompts[0].value : "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnRevision = useRef(0);
  const [memory, setMemory] = useState(emptyDraft);
  const memoryRef = useRef(emptyDraft);
  const [highlighted, setHighlighted] = useState<DraftField[]>([]);
  const highlightTimer = useRef<number | undefined>(undefined);
  const [market, setMarket] = useState<Market>();
  const [escrow, setEscrow] = useState<string>();
  const [transcript, setTranscript] = useState("");
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

  const applyDraft = useCallback((next: DraftMemory) => {
    const changed = changedFields(memoryRef.current.current, next.current);
    memoryRef.current = next;
    setMemory(next);
    if (next.current.status !== "confirmed") setEscrow(undefined);
    if (changed.length) {
      setHighlighted(changed);
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlighted([]), 2000);
    }
  }, []);

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  const condition = memory.current.condition;
  const marketCondition = condition && parseMarketCondition(condition) ? condition : undefined;
  useEffect(() => {
    if (!marketCondition) {setMarket(undefined); return;}
    const controller = new AbortController();
    setMarket({condition: marketCondition, notice: "Looking up active Gemini markets…"});
    void fetch(`/api/gemini?condition=${encodeURIComponent(marketCondition)}`, {signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error("Market lookup failed");
        const {choices}: {choices: MarketChoice[]} = await response.json();
        if (controller.signal.aborted) return;
        if (!choices.length) setMarket({condition: marketCondition, notice: "I couldn’t find an active Gemini market. Try its exact title."});
        else if (choices.length === 1) setMarket({condition: marketCondition, selected: choices[0], notice: ""});
        else setMarket({condition: marketCondition, choices, notice: "Which Gemini contract should determine release?"});
      })
      .catch(() => {
        if (!controller.signal.aborted) setMarket({condition: marketCondition, notice: "Gemini market data is temporarily unavailable."});
      });
    return () => controller.abort();
  }, [marketCondition]);

  const confirm = useCallback(() => {
    if (!ready) return "The workspace is still loading.";
    const current = memoryRef.current;
    if (current.current.status === "confirmed") return "This draft is already confirmed.";
    if (current.choices) return "Choose a recipient before confirming.";
    const draft = readyDraft(current);
    if (!draft) return nextDraftQuestion(current.current);
    if (parseMarketCondition(draft.condition)) return "Gemini market drafts are preview only.";
    const issue = guard(state, draft.amount);
    if (issue) return issue;
    const id = "AL-" + crypto.randomUUID().slice(0, 8).toUpperCase();
    setState(currentState => addEscrow(currentState, draft, id));
    applyDraft(confirmDraft(current));
    setEscrow(id);
    return `I placed ${money(draft.amount)} USDC in demo escrow for ${draft.recipient}.`;
  }, [applyDraft, ready, setState, state]);

  const addTurn = useCallback((prompt: string) => {
    stopReplyVoice();
    const revision = ++turnRevision.current;
    const id = crypto.randomUUID();
    let recognized = true;
    let reply = "For a payment, tell me the amount and recipient. You can also tell me what needs to happen before release.";
    const isConfirmation = /^confirm(?: (?:it|(?:the )?(?:draft|payment|escrow)))?[.!?]*$/i.test(prompt.trim());
    const repair = isConfirmation ? null : draftTurn(memoryRef.current, prompt);
    if (isConfirmation) reply = confirm();
    else if (repair) {
      applyDraft(repair.memory);
      reply = repair.reply;
    }
    else if (/pending|status|escrows|history|activity/i.test(prompt)) reply = escrows.length ? escrows.map(e => `${e.recipient} · ${money(e.amount)} USDC · ${e.status}. ${e.condition}.`).join("\n") : "There are no open escrows.";
    else if (/limit|spend|allow|permission/i.test(prompt)) reply = `You have ${money(remaining)} USDC available under your ${money(state.limit)} USDC workspace limit. Funding is ${state.allowHold ? "enabled" : "disabled"}, and releases are ${state.allowRelease ? "enabled" : "disabled"}.`;
    else if (/receiv|deposit/i.test(prompt)) reply = publicKey ? `Connected Solana address: ${publicKey.toBase58()}. Incoming transfers are simulated in this workspace.` : "Connect a Solana wallet from the workspace header to see its public address. Incoming transfers are simulated in this workspace.";
    else recognized = false;
    setTurns(previous => [...previous, {id, prompt, reply: recognized ? reply : "Thinking…", pending: !recognized}]);
    if (!recognized) {
      const current = memoryRef.current;
      const finish = (answer: string) => setTurns(previous =>
        previous.map(turn => turn.id === id ? {...turn, pending: false, reply: answer} : turn));
      void fetch("/api/plan", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          prompt,
          draft: current.current.status === "confirmed" ? null : current.current,
          history: turns.filter(turn => !turn.pending).slice(-4).map(({prompt, reply}) => ({prompt, reply: reply.slice(0, 400)})),
        }),
      }).then(async response => {
        if (response.status === 503) {finish(reply); return;}
        if (!response.ok) throw new Error("Planner failed");
        const plan: {reply: string; patch?: Partial<Draft>} = await response.json();
        if (!plan.patch) {finish(plan.reply); return;}
        if (revision !== turnRevision.current || current !== memoryRef.current) {
          finish("The draft changed while I was working. Repeat the edit if you still want it.");
          return;
        }
        if (current.choices) {finish("Choose a recipient before changing the draft."); return;}
        const next = editDraft(current, plan.patch);
        applyDraft(next);
        finish(next.choices ? "Which recipient should I use?" : nextDraftQuestion(next.current));
      }).catch(() => finish("I couldn’t reach the planner. If this is a payment, try stating the amount and recipient directly."));
    }
    setInput("");
    setNotice("");
  }, [applyDraft, confirm, escrows, publicKey, remaining, state.allowHold, state.allowRelease, state.limit, turns]);

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

  const send = useCallback((prompt: string) => {
    const instruction = prompt.trim().slice(0, 600);
    if (!instruction || leaving) return;
    if (intro) {
      openingPrompt.current = instruction;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) router.push("/agent/chat", {scroll: false});
      else setLeaving(true);
    } else {
      addTurn(instruction);
    }
  }, [addTurn, intro, leaving, openingPrompt, router]);
  const latestSend = useRef(send);
  useLayoutEffect(() => {latestSend.current = send;}, [send]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state.voice && input.trim()) unlockReplyVoice();
    if (voiceRef.current) {
      voiceRef.current.onresult = null;
      voiceRef.current.onend = null;
      voiceRef.current.stop();
      voiceRef.current = null;
      setListening(false);
      setTranscript("");
    }
    send(input);
  }

  function dictate() {
    if (listening) {
      stopReplyVoice();
      const active = voiceRef.current;
      voiceRef.current = null;
      active?.stop();
      setListening(false);
      setTranscript("");
      return;
    }
    const browser = window as Window & {SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition};
    const Engine = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Engine) {setNotice("Voice input is unavailable in this browser. You can still type an instruction."); return;}
    stopReplyVoice();
    if (state.voice) unlockReplyVoice();
    const recognition = new Engine();
    voiceRef.current = recognition;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    function finish() {
      if (voiceRef.current !== recognition) return false;
      voiceRef.current = null;
      setListening(false);
      setTranscript("");
      return true;
    }

    recognition.onresult = event => {
      if (voiceRef.current !== recognition) return;
      setTranscript(Array.from(event.results).map(result => result[0]?.transcript ?? "").join(" ").trim());
      const instruction = Array.from(event.results)
        .filter(result => result.isFinal)
        .map(result => result[0]?.transcript ?? "")
        .join(" ").trim();
      if (!instruction || !finish()) return;
      recognition.stop();
      latestSend.current(instruction);
    };
    recognition.onend = () => {finish();};
    recognition.onerror = () => {
      if (finish()) setNotice("Voice input stopped. Check your microphone permissions or type your instruction.");
    };
    setNotice("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      finish();
      setNotice("Could not start voice input.");
    }
  }

  const suggestions = <div className="suggestions">{prompts.map(prompt => <button key={prompt.label} onClick={() => {
    setInput(prompt.value);
    inputRef.current?.focus();
  }}>{prompt.label}<ArrowRight size={14}/></button>)}</div>;
  function toggleSpokenReplies() {
    if (state.voice) stopReplyVoice();
    else unlockReplyVoice();
    setState(current => ({...current, voice: !current.voice}));
  }

  const composer = (
      <div className="composer-wrap">
        {notice && <p className="notice" role="status">{notice}</p>}
        <form className="composer" onSubmit={submit}>{!intro && <VoiceOrb listening={listening}/>}<input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} maxLength={600} aria-label="Payment instruction" placeholder="Tell Ava what to do…"/>{state.microphone !== false && <button className="icon-button dictation-control" type="button" title="Dictate an instruction" aria-label={listening ? "Stop dictation" : "Start dictation"} aria-pressed={listening} onClick={dictate}>{listening ? <AudioLines size={20}/> : <Mic size={19}/>}<span>{listening ? "Stop" : "Speak"}</span></button>}<button type="submit" className="send" aria-label="Send instruction" disabled={!input.trim() || leaving}><ArrowUp size={20}/></button></form>
        <button className="reply-voice" type="button" aria-pressed={state.voice} onClick={toggleSpokenReplies}>
          Spoken replies {state.voice ? "on" : "off"}
        </button>
        <p className="composer-caption" role="status">{listening ? transcript || "Listening…" : ""}</p>
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
        <div className="turns" aria-live="polite">{turns.map(turn => <motion.article key={turn.id} initial={reduced || (arriving && turn === turns[0]) ? false : {opacity:0, y:8}} animate={{opacity:1,y:0}} className="turn">
          <p className="user-turn">{turn.prompt}</p>
          <div className="agent-turn"><Image className="reply-orb" src="/ava-reply-orb.webp" alt="" width={20} height={20} unoptimized/>
            <div><div className="reply-heading"><strong>Ava</strong>{state.voice && !turn.pending && <ReplyVoice text={turn.reply} autoPlay={!listening && turn.id === turns.at(-1)?.id}/>}</div><p>{turn.reply}</p></div>
          </div>
        </motion.article>)}</div>
        <PaymentDraft memory={memory} highlighted={highlighted} escrow={escrow} canConfirm={ready && Boolean(readyDraft(memory))}
          confirm={() => {if (state.voice) unlockReplyVoice(); addTurn("Confirm");}}
          undo={() => {if (state.voice) unlockReplyVoice(); addTurn("Undo");}}
          edit={(patch: Partial<Draft>) => {
            const next = editDraft(memoryRef.current, patch);
            applyDraft(next);
            setNotice(next.choices ? "Choose a recipient for this payment." : "Draft updated.");
          }}
          choose={index => {
            const next = chooseDraft(memoryRef.current, index);
            applyDraft(next);
            setNotice(nextDraftQuestion(next.current));
          }}
          market={marketCondition ? market?.condition === marketCondition ? market : {notice: "Looking up active Gemini markets…"} : undefined}
          chooseMarket={selected => {if (marketCondition) setMarket({condition: marketCondition, selected, notice: ""});}}/>
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
