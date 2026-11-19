"use client";

import {Square, Volume2} from "lucide-react";
import {useEffect, useRef, useState} from "react";

type Playback = {stop: () => void};
const currentPlayback = {stop: null as (() => void) | null};
export function stopReplyVoice() {currentPlayback.stop?.();}

export function ReplyVoice({text, elevenLabs}: {text:string; elevenLabs:boolean}) {
  const active = useRef<Playback | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState("");

  useEffect(() => () => {active.current?.stop();}, []);

  async function play() {
    if (active.current) {active.current.stop();return;}
    currentPlayback.stop?.();
    setError("");
    const controller = new AbortController();
    let audio: HTMLAudioElement | undefined;
    let url: string | undefined;
    let utterance: SpeechSynthesisUtterance | undefined;
    const stop = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      if (currentPlayback.stop === stop) currentPlayback.stop = null;
      active.current = null;
      if (audio) {audio.pause();audio.removeAttribute("src");}
      if (url) URL.revokeObjectURL(url);
      if (utterance) window.speechSynthesis.cancel();
      setStatus("idle");
    };
    active.current = {stop};
    currentPlayback.stop = stop;
    setStatus("loading");

    if (elevenLabs) {
      try {
        const response = await fetch("/api/voice", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({text:text.slice(0,600)}),
          signal:controller.signal,
        });
        if (!response.ok) throw Error("Voice unavailable");
        const clip = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(clip);
        audio = new Audio(url);
        await audio.play();
        if (controller.signal.aborted) return;
        audio.onended = stop;
        audio.onerror = () => {stop();setError("Could not play this reply.");};
        setStatus("playing");
        return;
      } catch {
        audio?.pause();
        if (url) {URL.revokeObjectURL(url);url = undefined;}
        if (controller.signal.aborted) return;
      }
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
  }

  return <>
    <button type="button" className="reply-voice" onClick={() => void play()} aria-label={status === "idle" ? "Listen to Ava’s reply" : "Stop spoken reply"}>
      {status === "idle" ? <Volume2 size={15}/> : <Square size={13}/>}
      {status === "idle" ? "Listen" : status === "loading" ? "Loading voice…" : "Stop"}
    </button>
    {error && <small role="status">{error}</small>}
  </>;
}
