"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {ArrowDown, ArrowUpRight} from "lucide-react";
import {Brand} from "./brand";
import {VoiceOrb} from "./voice-orb";

const agentPath = "/agent";

export function LandingHero() {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!launching) return;
    const transition = window.setTimeout(() => router.push(agentPath), 420);
    return () => window.clearTimeout(transition);
  }, [launching, router]);

  return <section className="hero" aria-labelledby="hero-title">
    <header className="marketing-nav wrap">
      <Brand/>
      <nav aria-label="Main navigation"><a href="#how">How it works</a><a href="#safety">Safety</a></nav>
    </header>
    <div className="hero-stage wrap">
      <div className="hero-copy">
        <h1 id="hero-title">Talk to Ava.<br/>Hold USDC.</h1>
        <p className="hero-description">Ava is a voice-first payment assistant. Say who to pay and when to release the funds. Review the terms, then try the escrow on Solana Devnet or in Simulation.</p>
        <div className="hero-actions">
          <Link className="button primary" href={agentPath} onNavigate={event => {
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            event.preventDefault();
            setLaunching(true);
          }}>Talk to Ava <ArrowUpRight size={16}/></Link>
        </div>
      </div>
      <div className="hero-orb" data-launching={launching} aria-hidden="true">
        <VoiceOrb listening={false} large processing={launching}/>
      </div>
    </div>
    <div className="hero-footer wrap"><a href="#how" className="text-link">How Ava works <ArrowDown size={15}/></a></div>
  </section>;
}
