import Link from "next/link";
import Image from "next/image";
import {ArrowUpRight} from "lucide-react";
import {Brand} from "../components/brand";
import {demoInstruction} from "../lib/payments";
import {Reveal} from "../components/reveal";

import {LandingHero} from "../components/landing-hero";

export default function Home() {
  return <main className="landing">
    <LandingHero/>

    <section id="how" className="landing-section instruction-section">
      <Reveal>
        <div className="wrap instruction-content">
          <div>
            <h2>Start with a sentence</h2>
            <p>Tell Ava the amount, recipient, and release condition. Review the draft before funding, then follow the payment in Activity.</p>
          </div>
          <figure className="example-chat" aria-label="Example of drafting a payment with Ava">
            <figcaption>Example conversation</figcaption>
            <p className="user-turn">{demoInstruction}</p>
            <div className="agent-turn">
              <Image className="reply-orb" src="/ava-reply-orb.webp" alt="" width={20} height={20} unoptimized/>
              <div>
                <strong>Ava</strong>
                <p>Review the terms before placing funds in escrow.</p>
                <div className="draft payment-draft example-draft">
                  <h3>Payment draft</h3>
                  <dl>
                    <div><dt>Amount</dt><dd>250.00 USDC</dd></div>
                    <div><dt>Recipient</dt><dd>Maya Chen</dd></div>
                    <div><dt>Release condition</dt><dd>Final files delivered</dd></div>
                  </dl>
                </div>
              </div>
            </div>
          </figure>
        </div>
      </Reveal>
    </section>

    <section id="safety" className="landing-section safety-section">
      <Reveal>
        <div className="wrap safety-content">
          <h2>You set the boundaries</h2>
          <ul className="safety-options" role="list">
            <li><h3>Set a spending limit</h3><p>Decide how much Ava can commit across payments.</p></li>
            <li><h3>Choose what Ava can do</h3><p>Control whether Ava can fund escrows or release payments.</p></li>
            <li><h3>Pause anytime</h3><p>Block new funding and releases while you review existing escrows.</p></li>
          </ul>
          <Link href="/settings" className="text-link">Explore permissions <ArrowUpRight size={15}/></Link>
        </div>
      </Reveal>
    </section>
    <footer className="wrap marketing-footer">
      <Brand/><span>Built for the UBC 2026 Hackathon</span><Link href="/agent">Open workspace <ArrowUpRight size={14}/></Link>
    </footer>
  </main>;
}
