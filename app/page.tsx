import Link from "next/link";
import Image from "next/image";
import {ArrowUpRight, ClipboardCheck, MessageSquare, Route} from "lucide-react";
import {Brand} from "../components/brand";
import {demoInstruction} from "../lib/payments";
import {LandingHero} from "../components/landing-hero";

export default function Home() {
  return <main className="landing">
    <LandingHero/>

    <section id="how" className="landing-section instruction-section">
      <div className="wrap instruction-content">
        <div className="instruction-copy">
          <h2>Start with a sentence</h2>
          <ol className="payment-steps" role="list">
            <li><MessageSquare size={18} aria-hidden="true"/><div><h3>Tell Ava what to hold</h3><p>Say who to pay, how much, and when to release it.</p></div></li>
            <li><ClipboardCheck size={18} aria-hidden="true"/><div><h3>Review the draft</h3><p>Check the terms before you fund the escrow.</p></div></li>
            <li><Route size={18} aria-hidden="true"/><div><h3>Follow the payment</h3><p>Open Activity to see when funds are held or released.</p></div></li>
          </ol>
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
    </section>

    <section id="safety" className="landing-section safety-section">
      <div className="wrap safety-content">
        <div>
          <h2>You set the boundaries</h2>
          <Link href="/settings" className="text-link">Explore permissions <ArrowUpRight size={15}/></Link>
        </div>
        <ul className="safety-options" role="list">
          <li><h3>Set a spending limit</h3><p>Decide how much Ava can commit across payments.</p></li>
          <li><h3>Choose what Ava can do</h3><p>Control whether Ava can fund escrows or release payments.</p></li>
          <li><h3>Pause anytime</h3><p>Block new funding and releases while you review existing escrows.</p></li>
        </ul>
      </div>
    </section>
    <footer className="wrap marketing-footer">
      <Brand/><span>Built for the UBC 2026 Hackathon</span><Link href="/agent">Open workspace <ArrowUpRight size={14}/></Link>
    </footer>
  </main>;
}
