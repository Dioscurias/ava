"use client";
import Link from "next/link";
import Image from "next/image";
import {useRouter} from "next/navigation";
import {EscrowHistory} from "./escrow-history";
import {ReplyVoice, stopReplyVoice, unlockReplyVoice} from "./reply-voice";
import {VoiceOrb} from "./voice-orb";
import {useWallet} from "@solana/wallet-adapter-react";
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {motion, useReducedMotion} from "framer-motion";
import {ArrowRight, ArrowUp, AudioLines, ChevronDown, LockKeyhole, Mic, ShieldCheck} from "lucide-react";
import {active, committed, demoInstruction, displayCondition, guard, money, type Draft} from "../lib/payments";
import {describeMarketPreview, parseMarketCondition, type MarketChoice} from "../lib/gemini-condition";
import {JudgeDevnet} from "./judge-devnet";
import {PaymentDraft} from "./payment-draft";
import {applyPlannedDraft, changedFields, describeDraftChange, chooseDraft, confirmDraft, draftTurn, editDraft, emptyDraft, nextDraftQuestion, readyDraft, resolveKnownRecipient, type DraftField, type DraftMemory} from "../lib/draft-memory";
import {StatusBadge, useWorkspace} from "./workspace";
import {classifyWorkspaceQuestion, isDraftQuestion} from "../lib/ava-plan";
import {readSpeechTurn, speechSilenceMs, type RecognitionResult} from "../lib/speech-turn";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: {results: ArrayLike<RecognitionResult>}) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: {error: string}) => void) | null;
};
type Turn = {id: string; prompt: string; reply: string; pending?: boolean};
type Market = {condition: string; choices?: MarketChoice[]; selected?: MarketChoice; notice: string};
const btcPrompt = "Hold 5 USDC for Dave until the next BTC 5-minute round settles up";
const prompts = [
  {label:"Hold a payment", value:demoInstruction},
  {label:btcPrompt, value:btcPrompt},
  {label:"Check Solana Devnet", value:"Check Solana Devnet"},
  {label:"Check payment status", value:"What payments are pending?"},
  {label:"Review my limits", value:"What can you spend?"},
  {label:"Get receiving details", value:"How do I receive USDC?"},
];

export function Agent({demo, intro = false, devnet = false}: {demo: boolean; intro?: boolean; devnet?: boolean}) {
  const router = useRouter();
  const {state, update, ready, saving, openingPrompt, openingVoice} = useWorkspace();
  const {publicKey} = useWallet();
  const [leaving, setLeaving] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [input, setInput] = useState(demo ? prompts[0].value : "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const turnRevision = useRef(0);
  const [memory, setMemory] = useState(emptyDraft);
  const memoryRef = useRef(emptyDraft);
  const [highlighted, setHighlighted] = useState<DraftField[]>([]);
  const highlightTimer = useRef<number | undefined>(undefined);
  const [market, setMarket] = useState<Market>();
  const pinnedMarkets = useRef(new Map<string, MarketChoice>());
  const marketRequests = useRef(new Map<string, Promise<MarketChoice[]>>());
  const [escrow, setEscrow] = useState<string>();
  const [devnetReceipt, setDevnetReceipt] = useState<string>();
  const [transcript, setTranscript] = useState("");
  const [voiceSession, setVoiceSession] = useState(false);
  const voiceSessionRef = useRef(false);
  const rearmTimer = useRef<number | undefined>(undefined);
  const phraseTimer = useRef<number | undefined>(undefined);
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
  const currentAmount = memory.current.amount;
  const overLimit = currentAmount !== undefined && currentAmount > remaining;
  useEffect(() => {
    if (showHistory || (!turns.length && !memory.current.amount)) return;
    conversationEnd.current?.scrollIntoView({behavior: reduced ? "instant" : "smooth", block: "nearest"});
  }, [turns, memory.current, market, reduced, showHistory]);
  useEffect(() => () => {
    window.clearTimeout(rearmTimer.current);
    window.clearTimeout(phraseTimer.current);
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
    if (next.current.status !== "confirmed") {
      setEscrow(undefined);
      setDevnetReceipt(undefined);
    }
    if (changed.length) {
      setHighlighted(changed);
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlighted([]), 2000);
    }
  }, []);

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  const condition = memory.current.condition;
  const marketCondition = condition && parseMarketCondition(condition) ? condition : undefined;
  const lookupMarket = useCallback((condition: string) => {
    const pinned = pinnedMarkets.current.get(condition);
    if (pinned) return Promise.resolve([pinned]);
    const pending = marketRequests.current.get(condition);
    if (pending) return pending;
    const request = fetch(`/api/gemini?condition=${encodeURIComponent(condition)}`, {signal: AbortSignal.timeout(10_000)})
      .then(async response => {
        if (!response.ok) throw new Error("Market lookup failed");
        const {choices}: {choices: MarketChoice[]} = await response.json();
        if (choices.length === 1) pinnedMarkets.current.set(condition, choices[0]);
        return choices;
      })
      .finally(() => marketRequests.current.delete(condition));
    marketRequests.current.set(condition, request);
    return request;
  }, []);

  useEffect(() => {
    if (!marketCondition) {setMarket(undefined); return;}
    let current = true;
    setMarket({condition: marketCondition, notice: "Looking up active Gemini markets…"});
    void lookupMarket(marketCondition)
      .then(choices => {
        if (!current) return;
        if (!choices.length) setMarket({condition: marketCondition, notice: "I couldn’t find an active Gemini market. Try its exact title."});
        else if (choices.length === 1) setMarket({condition: marketCondition, selected: choices[0], notice: ""});
        else setMarket({condition: marketCondition, choices, notice: "Which Gemini contract should determine release?"});
      })
      .catch(() => {
        if (current) setMarket({condition: marketCondition, notice: "Gemini market data is temporarily unavailable."});
      });
    return () => {current = false;};
  }, [lookupMarket, marketCondition]);

  const marketReply = useCallback(async (condition: string) => {
    try {
      const choices = await lookupMarket(condition);
      return describeMarketPreview(condition, choices.length === 1 ? choices[0] : undefined);
    } catch {
      return describeMarketPreview(condition);
    }
  }, [lookupMarket]);

  const confirming = useRef(false);
  const confirmationIds = useRef(new WeakMap<DraftMemory, string>());
  const confirm = useCallback(async () => {
    if (!ready) return "The workspace is still loading.";
    if (confirming.current) return "This escrow is already being confirmed.";
    const current = memoryRef.current;
    if (current.current.status === "confirmed") return "This draft is already confirmed.";
    if (current.choices) return "Choose a recipient before confirming.";
    const draft = readyDraft(current);
    if (!draft) return nextDraftQuestion(current.current);
    if (parseMarketCondition(draft.condition)) return describeMarketPreview(draft.condition, pinnedMarkets.current.get(draft.condition));
    if (devnet) return "Review the fixed test amount and recipient, then use the Devnet confirm button.";
    const issue = guard(state, draft.amount);
    if (issue) return issue;
    const id = confirmationIds.current.get(current) ?? "AL-" + crypto.randomUUID().replaceAll("-", "").toUpperCase();
    confirmationIds.current.set(current, id);
    confirming.current = true;
    try {
      await update({type:"create", draft, id});
    } catch (error) {
      return error instanceof Error ? error.message : "Could not save the escrow.";
    } finally {
      confirming.current = false;
    }
    if (memoryRef.current === current) {
      applyDraft(confirmDraft(current));
      setEscrow(id);
    }
    return `I placed ${money(draft.amount)} USDC in demo escrow for ${draft.recipient}.`;
  }, [applyDraft, devnet, ready, update, state]);

  const addTurn = useCallback((prompt: string) => {
    stopReplyVoice();
    const revision = ++turnRevision.current;
    const id = crypto.randomUUID();
    let recognized = true;
    let previewCondition: string | undefined;
    let reply = "For a payment, tell me the amount and recipient. You can also tell me what needs to happen before release.";
    const isConfirmation = /^confirm(?: (?:it|(?:the )?(?:draft|payment|escrow)))?[.!?]*$/i.test(prompt.trim());
    const chainRead = /^(?:check|show|verify) (?:the )?(?:solana )?devnet(?: status)?[.!?]*$/i.test(prompt.trim());
    const currentDraft = memoryRef.current;
    const workspaceQuestion = classifyWorkspaceQuestion(prompt);
    const local = isConfirmation || chainRead || workspaceQuestion ? null : draftTurn(currentDraft, prompt);
    const names = state.escrows.map(escrow => escrow.recipient);
    const repair = local && !/^undo[.!?]*$/i.test(prompt.trim())
      ? resolveKnownRecipient(currentDraft, local.memory, names) ?? local : local;
    if (isConfirmation || chainRead) recognized = isConfirmation;
    else if (repair) {
      applyDraft(repair.memory);
      const terms = readyDraft(repair.memory);
      reply = repair.reply;
      if (terms && parseMarketCondition(terms.condition) && !/^undo[.!?]*$/i.test(prompt.trim())) {
        previewCondition = terms.condition;
      }
    }
    else if (workspaceQuestion === "activity") reply = escrows.length ? escrows.map(e => `${e.recipient} · ${money(e.amount)} USDC · ${e.status}. ${displayCondition(e.condition)}.`).join("\n") : "There are no open escrows.";
    else if (workspaceQuestion === "limits") reply = `You have ${money(remaining)} USDC available under your ${money(state.limit)} USDC workspace limit. ${state.paused ? "Ava is paused. Funding and releases are disabled." : `Funding is ${state.allowHold ? "enabled" : "disabled"}, and releases are ${state.allowRelease ? "enabled" : "disabled"}.`}`;
    else if (workspaceQuestion === "receive") reply = publicKey ? `Connected Solana address: ${publicKey.toBase58()}. Incoming transfers are simulated in this workspace.` : "Connect a Solana wallet from the workspace header to see its public address. Incoming transfers are simulated in this workspace.";
    else recognized = false;
    const pending = isConfirmation || !recognized || Boolean(previewCondition);
    setTurns(previous => [...previous, {id, prompt, reply: pending ? "Thinking…" : reply, pending}]);
    const finish = (answer: string) => setTurns(previous =>
      previous.map(turn => turn.id === id ? {...turn, pending: false, reply: answer} : turn));
    if (isConfirmation) void confirm().then(finish);
    else if (previewCondition) void marketReply(previewCondition).then(finish);
    if (!recognized) {
      const current = memoryRef.current;
      if (chainRead) {
        void fetch("/api/devnet/status", {cache: "no-store", signal: AbortSignal.timeout(8_000)})
          .then(async response => {
            if (!response.ok) throw new Error("Devnet status unavailable");
            const {rpc, classicSpl, decimals, programExecutable} = await response.json();
            if (!rpc?.healthy || !Number.isSafeInteger(rpc.slot)) throw new Error("Devnet RPC unavailable");
            const mint = classicSpl && decimals === 6
              ? "I verified the Circle test USDC mint uses the SPL Token Program and has six decimals."
              : "I couldn’t verify the Circle test USDC mint.";
            const program = programExecutable ? "The Ava escrow program is executable." : "Ava’s escrow program is unavailable.";
            finish(`Solana Devnet is responding at slot ${rpc.slot.toLocaleString()}. ${mint} ${program}`);
          })
          .catch(() => finish("I couldn’t verify Solana Devnet right now. Try again shortly."));
      } else void fetch("/api/plan", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          prompt,
          mode: devnet ? "devnet" : "simulation",
          draft: current.current.status === "confirmed" ? null : current.current,
          history: turns.filter(turn => !turn.pending).slice(-4).map(({prompt, reply}) => ({prompt, reply: reply.slice(0, 400)})),
        }),
      }).then(async response => {
        if (response.status === 503) {finish(reply); return;}
        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          if (failure?.code === "planner_access") {
            finish("Grok access is unavailable right now. You can still draft a payment with an amount, recipient, and release condition.");
            return;
          }
          throw new Error("Planner failed");
        }
        const plan: {reply: string; patch?: Partial<Draft>} = await response.json();
        if (!plan.patch || isDraftQuestion(prompt)) {finish(plan.reply); return;}
        if (revision !== turnRevision.current || current !== memoryRef.current) {
          finish("The draft changed while I was working. Repeat the edit if you still want it.");
          return;
        }
        if (current.choices) {finish("Choose a recipient before changing the draft."); return;}
        const planned = applyPlannedDraft(current, prompt, plan.patch);
        const result = resolveKnownRecipient(current, planned.memory, names) ?? planned;
        applyDraft(result.memory);
        const terms = readyDraft(result.memory);
        finish(terms && parseMarketCondition(terms.condition) ? await marketReply(terms.condition) : result.reply);
      }).catch(() => finish("I couldn’t reach the planner. If this is a payment, try stating the amount and recipient directly."));
    }
    setInput("");
    setNotice("");
  }, [applyDraft, confirm, devnet, escrows, marketReply, publicKey, remaining, state.allowHold, state.allowRelease, state.escrows, state.limit, state.paused, turns]);

  useEffect(() => {if (intro) router.prefetch("/agent/chat");}, [intro, router]);

  useLayoutEffect(() => {
    if (intro || !ready || !openingPrompt.current) return;
    const prompt = openingPrompt.current;
    openingPrompt.current = "";
    voiceSessionRef.current = openingVoice.current;
    setVoiceSession(openingVoice.current);
    openingVoice.current = false;
    setArriving(true);
    addTurn(prompt);
    window.scrollTo({top: 0, behavior: "instant"});
    headingRef.current?.focus({preventScroll: true});
  }, [addTurn, intro, openingPrompt, openingVoice, ready]);

  const send = useCallback((prompt: string) => {
    const instruction = prompt.trim().slice(0, 600);
    if (!instruction || leaving) return;
    if (intro) {
      openingPrompt.current = instruction;
      openingVoice.current = voiceSessionRef.current;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) router.push("/agent/chat", {scroll: false});
      else setLeaving(true);
    } else {
      addTurn(instruction);
    }
  }, [addTurn, intro, leaving, openingPrompt, openingVoice, router]);
  const latestSend = useRef(send);
  useLayoutEffect(() => {latestSend.current = send;}, [send]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state.voice && input.trim()) unlockReplyVoice();
    stopListening();
    send(input);
  }

  function stopListening() {
    window.clearTimeout(phraseTimer.current);
    const active = voiceRef.current;
    voiceRef.current = null;
    active?.stop();
    setListening(false);
    setTranscript("");
  }

  function stopConversation() {
    voiceSessionRef.current = false;
    setVoiceSession(false);
    window.clearTimeout(rearmTimer.current);
    stopListening();
    stopReplyVoice();
  }

  const listen = useCallback(function startRecognition() {
    if (!voiceSessionRef.current || voiceRef.current) return;
    const browser = window as Window & {SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition};
    const Engine = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Engine) {
      voiceSessionRef.current = false;
      setVoiceSession(false);
      setNotice("Voice input is unavailable in this browser. You can still type an instruction.");
      return;
    }
    const recognition = new Engine();
    voiceRef.current = recognition;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    function finish() {
      if (voiceRef.current !== recognition) return false;
      voiceRef.current = null;
      window.clearTimeout(phraseTimer.current);
      setListening(false);
      setTranscript("");
      return true;
    }

    let utterance = {preview:"", complete:""};
    recognition.onresult = event => {
      if (voiceRef.current !== recognition) return;
      utterance = readSpeechTurn(event.results);
      setTranscript(utterance.preview);
      window.clearTimeout(phraseTimer.current);
      if (utterance.complete) {
        phraseTimer.current = window.setTimeout(() => recognition.stop(), speechSilenceMs);
      }
    };
    function endSession(notice: string) {
      if (!finish()) return;
      voiceSessionRef.current = false;
      setVoiceSession(false);
      if (utterance.preview) setInput(current => current || utterance.preview.slice(0, 600));
      setNotice(notice);
    }
    recognition.onend = () => {
      if (utterance.complete) {
        if (finish()) latestSend.current(utterance.complete);
      } else if (utterance.preview) {
        endSession("The browser stopped listening before the transcript was final. Review it before sending.");
      } else if (finish() && voiceSessionRef.current) {
        rearmTimer.current = window.setTimeout(startRecognition, 450);
      }
    };
    recognition.onerror = ({error}) => {
      if (error === "no-speech" && !utterance.preview) return;
      endSession(utterance.preview
        ? "Voice input stopped. Review the captured text before sending."
        : "Voice input stopped. Check your microphone permissions or tap Speak to try again.");
    };
    setNotice("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      endSession("Could not start voice input.");
    }
  }, []);

  const resumeVoice = useCallback(() => {
    if (!voiceSessionRef.current) return;
    window.clearTimeout(rearmTimer.current);
    rearmTimer.current = window.setTimeout(listen, 300);
  }, [listen]);

  const latestTurn = turns.at(-1);
  useEffect(() => {
    if (voiceSession && !state.voice && latestTurn && !latestTurn.pending) resumeVoice();
  }, [voiceSession, state.voice, latestTurn, resumeVoice]);

  function dictate() {
    if (voiceSessionRef.current) {
      stopConversation();
      return;
    }
    stopReplyVoice();
    if (state.voice) unlockReplyVoice();
    voiceSessionRef.current = true;
    setVoiceSession(true);
    listen();
  }

  const suggestions = <div className="suggestions">{prompts.map(prompt => <button key={prompt.label} onClick={() => {
    setInput(prompt.value);
    inputRef.current?.focus();
  }}>{prompt.label}<ArrowRight size={14}/></button>)}</div>;
  function toggleSpokenReplies() {
    if (state.voice) stopReplyVoice();
    else unlockReplyVoice();
    void update({type:"preference", key:"voice", value:!state.voice})
      .catch(error => setNotice(error instanceof Error ? error.message : "Could not save your voice preference."));
  }

  const composer = (
      <div className="composer-wrap">
        {notice && <p className="notice" role="status">{notice}</p>}
        <form className="composer" onSubmit={submit}>{!intro && <VoiceOrb listening={listening}/>}<input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} maxLength={600} aria-label="Payment instruction" placeholder="Tell Ava what to do…"/>{state.microphone !== false && <button className="icon-button dictation-control" type="button" title="Dictate an instruction" aria-label={voiceSession ? "Stop voice conversation" : "Start voice conversation"} aria-pressed={voiceSession} onClick={dictate}>{listening ? <AudioLines size={20}/> : <Mic size={19}/>}<span>{voiceSession ? "Stop" : "Speak"}</span></button>}<button type="submit" className="send" aria-label="Send instruction" disabled={!input.trim() || leaving}><ArrowUp size={20}/></button></form>
        <div className="composer-meta">
          <p className="voice-status" role="status" data-listening={listening}>
            {voiceSession && <span className="voice-meter" aria-hidden="true"><i/><i/><i/><i/><i/></span>}
            {listening ? transcript || "Listening…" : voiceSession ? "Ava is responding…" : ""}
          </p>
          <button className="reply-voice" type="button" aria-pressed={state.voice} onClick={toggleSpokenReplies}>
            Spoken replies {state.voice ? "on" : "off"}
          </button>
        </div>
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
      <div className="agent-top"><h1 ref={headingRef} tabIndex={-1}>{devnet ? "Ava agent · Devnet" : "Ava agent"}</h1></div>
      <div className="agent-views" role="group" aria-label="Agent workspace view">
        <button type="button" aria-pressed={!showHistory} aria-controls="agent-conversation" onClick={() => setShowHistory(false)}>Conversation</button>
        <button type="button" aria-pressed={showHistory} aria-controls="agent-history" onClick={() => {
          if (!showHistory) stopConversation();
          setShowHistory(true);
        }}>Escrow history</button>
      </div>
      <div id="agent-history" hidden={!showHistory}>
        {showHistory && <EscrowHistory escrows={state.escrows}/>}
      </div>
      <div id="agent-conversation" className="agent-conversation-view" hidden={showHistory}>
      <div className="conversation">
        {turns.length === 0 && <div className="welcome"><h2>What should move?</h2><p>Tell Ava who to pay and when.</p>{suggestions}</div>}
        <div className="turns" aria-live="polite">{turns.map(turn => <motion.article key={turn.id} initial={reduced || (arriving && turn === turns[0]) ? false : {opacity:0, y:8}} animate={{opacity:1,y:0}} className="turn">
          <p className="user-turn">{turn.prompt}</p>
          <div className="agent-turn"><Image className="reply-orb" src="/ava-reply-orb.webp" alt="" width={20} height={20} unoptimized/>
            <div><div className="reply-heading"><strong>Ava</strong>{state.voice && !turn.pending && <ReplyVoice text={turn.reply} listening={listening} autoPlay={!showHistory && !listening && turn.id === latestTurn?.id} onFinished={voiceSession && turn.id === latestTurn?.id ? resumeVoice : undefined}/>}</div><p>{turn.reply}</p></div>
          </div>
        </motion.article>)}</div>
        <PaymentDraft devnet={devnet} devnetReceipt={devnet ? devnetReceipt : undefined} memory={memory} highlighted={highlighted} escrow={escrow}
          paused={state.paused} availableLimit={overLimit ? remaining : undefined}
          canConfirm={ready && !saving && currentAmount !== undefined && Boolean(readyDraft(memory)) && !guard(state, currentAmount)}
          confirm={() => {if (state.voice) unlockReplyVoice(); addTurn("Confirm");}}
          undo={() => {if (state.voice) unlockReplyVoice(); addTurn("Undo");}}
          edit={(patch: Partial<Draft>) => {
            const current = memoryRef.current;
            const next = editDraft(current, patch);
            const recipient = resolveKnownRecipient(current, next, state.escrows.map(escrow => escrow.recipient));
            applyDraft(recipient?.memory ?? next);
            setNotice(recipient?.reply ?? describeDraftChange(current, next));
          }}
          choose={index => {
            const next = chooseDraft(memoryRef.current, index);
            applyDraft(next);
            setNotice(nextDraftQuestion(next.current));
          }}
          market={marketCondition ? market?.condition === marketCondition ? market : {notice: "Looking up active Gemini markets…"} : undefined}
          chooseMarket={selected => {
            if (!marketCondition) return;
            pinnedMarkets.current.set(marketCondition, selected);
            setMarket({condition: marketCondition, selected, notice: ""});
          }}/>
        {devnet && memory.current.status !== "incomplete" && !memory.choices && !marketCondition && memory.current.condition && (
          <JudgeDevnet draftCondition={memory.current.condition}
            fundingBlocked={!ready || overLimit || Boolean(guard(state, 10))}
            draftConfirmed={memory.current.status === "confirmed"}
            onFunded={(condition, receipt) => {
              const current = memoryRef.current;
              if (current.current.condition !== condition || !readyDraft(current)) return;
              applyDraft(confirmDraft(editDraft(current, {amount: 10, recipient: receipt.recipient})));
              setDevnetReceipt(receipt.explorerUrl);
              setEscrow(`DV-${receipt.requestId}`);
            }}/>
        )}
        <div className="conversation-end" ref={conversationEnd}/>
      </div>
      {composer}
      </div>
    </section>
    <aside className="agent-side">
      <section className="panel">
        <button className="panel-heading" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen} aria-controls="active-escrows"><span><LockKeyhole size={16}/> Active escrows <small>{escrows.length}</small></span><ChevronDown size={17} className={panelOpen ? "" : "-rotate-90"}/></button>
        {panelOpen && <div id="active-escrows">{escrows.length ? escrows.map(e => <Link className="escrow-row" key={e.id} href={`/payments/${e.id}`}><div><strong>{e.recipient}</strong><span>{money(e.amount)} USDC</span></div><StatusBadge status={e.status}/><p>{displayCondition(e.condition)}</p></Link>) : <p className="panel-empty">No funds are currently held. Confirm a payment to see it here.</p>}</div>}
      </section>
      <section className="panel limit-panel"><div className="panel-heading"><span><ShieldCheck size={17}/> Spending limits</span></div><div className="limit-details"><strong>{money(remaining)} <small>USDC</small></strong><p>Available of {money(state.limit)} USDC</p><progress max={state.limit || 1} value={Math.min(committed(state), state.limit)} aria-label="Workspace spending limit used"/><p>{state.paused ? "Agent paused · Funding and releases disabled" : `Funding ${state.allowHold ? "enabled" : "disabled"} · Releases ${state.allowRelease ? "enabled" : "disabled"}`}</p><Link href="/settings" className="text-link">Manage permissions <ArrowRight size={14}/></Link></div></section>
    </aside>
  </main>;
}
