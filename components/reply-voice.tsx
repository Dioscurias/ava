"use client";

import {Square, Volume2} from "lucide-react";
import {useCallback, useEffect, useRef, useState} from "react";

type Playback = {stop: () => void};
const currentPlayback = {stop: null as (() => void) | null};
export function stopReplyVoice() {currentPlayback.stop?.();}

let output: AudioContext | undefined;

// Resume inside the click or submit handler, before synthesis or speech recognition.
export function unlockReplyVoice() {
  try {
    const browser = window as Window & {webkitAudioContext?: typeof AudioContext};
    const Context = window.AudioContext ?? browser.webkitAudioContext;
    if (!Context) return;
    output ??= new Context();
    if (output.state !== "running") void output.resume().catch(() => {});
  } catch {
    // A blocked or unsupported audio context is handled by the player.
  }
}

export function ReplyVoice({text, autoPlay}: {text:string; autoPlay:boolean}) {
  const active = useRef<Playback | null>(null);
  const autoStarted = useRef(false);
  const cachedClip = useRef<AudioBuffer | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState("");

  useEffect(() => () => {active.current?.stop();}, []);

  const play = useCallback(async () => {
    if (active.current) {active.current.stop();return;}
    currentPlayback.stop?.();
    setError("");
    const controller = new AbortController();
    let source: AudioBufferSourceNode | undefined;
    let utterance: SpeechSynthesisUtterance | undefined;
    const stop = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      if (currentPlayback.stop === stop) currentPlayback.stop = null;
      active.current = null;
      if (source) {source.onended = null; source.stop(); source.disconnect();}
      if (utterance) window.speechSynthesis.cancel();
      setStatus("idle");
    };
    active.current = {stop};
    currentPlayback.stop = stop;
    setStatus("loading");

    const player = output;
    if (player && player.state !== "running") {
      let timeout: number | undefined;
      try {
        await Promise.race([player.resume(), new Promise(resolve => { timeout = window.setTimeout(resolve, 750); })]);
      } catch {
        // The state check below offers manual retry when audio remains locked.
      } finally {
        window.clearTimeout(timeout);
      }
    }
    if (controller.signal.aborted) return;
    if (player?.state !== "running") {
      stop();
      setError("Tap Listen to enable audio.");
      return;
    }
    try {
      let clip = cachedClip.current;
      if (!clip) {
        const response = await fetch("/api/voice", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({text: text.slice(0, 600)}),
          signal: controller.signal,
        });
        if (!response.ok) throw Error("Voice unavailable");
        clip = await player.decodeAudioData(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        cachedClip.current = clip;
      }
      if (controller.signal.aborted) return;
      if (player.state !== "running") {
        stop();
        setError("Tap Listen to resume audio.");
        return;
      }
      const node = player.createBufferSource();
      node.buffer = clip;
      node.connect(player.destination);
      node.start();
      source = node;
      node.onended = stop;
      setStatus("playing");
      return;
    } catch {
      if (controller.signal.aborted) return;
      setError("ElevenLabs is unavailable. Using your device voice.");
    }

    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      stop();
      setError("Spoken replies are unavailable on this device.");
      return;
    }
    utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = .95;
    utterance.onend = stop;
    utterance.onerror = () => {
      if (!controller.signal.aborted) {stop();setError("Could not play this reply.");}
    };
    window.speechSynthesis.speak(utterance);
    setStatus("playing");
  }, [text]);

  useEffect(() => {
    if (!autoPlay || autoStarted.current) return;
    const frame = window.setTimeout(() => {
      autoStarted.current = true;
      if (!active.current) void play();
    }, 0);
    return () => window.clearTimeout(frame);
  }, [autoPlay, play]);

  return <>
    <button type="button" className="reply-voice" onClick={() => {autoStarted.current = true; if (!active.current) unlockReplyVoice(); void play();}} aria-label={status === "idle" ? "Listen to Ava’s reply" : "Stop spoken reply"}>
      {status === "idle" ? <Volume2 size={15}/> : <Square size={13}/>}
      {status === "idle" ? "Listen" : "Stop"}
    </button>
    {error && <small role="status">{error}</small>}
  </>;
}
