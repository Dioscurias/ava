import Link from "next/link";
import Image from "next/image";
import {ArrowDown, ArrowUpRight} from "lucide-react";
import {Brand} from "../components/brand";
import {demoInstruction} from "../lib/payments";
import {Reveal} from "../components/reveal";
import {VoiceOrb} from "../components/voice-orb";

const walkthrough = [
  {
    tone: "instruction",
    title: "Tell Ava what to do",
    body: "Type or dictate the amount, recipient, and what needs to happen before release.",
    image: "/ava-instruction.jpg",
    detail: "/ava-instruction-detail.webp",
    width: 908,
    height: 718,
    alt: "Ava’s opening screen with the orb and a 250 USDC instruction typed into the command bar",
  },
  {
    tone: "review",
    title: "Review the proposed payment",
    body: "Check the amount, recipient, and condition before confirming the escrow.",
    image: "/ava-review.jpg",
    detail: "/ava-review-detail.webp",
    width: 930,
    height: 375,
    alt: "Payment review showing 250 USDC for Maya Chen, with delivery of the final files as the release condition",
  },
  {
    tone: "timeline",
    title: "Follow the money",
    body: "The timeline records when funds were held, when the condition was confirmed, and when they were released.",
    image: "/ava-timeline.jpg",
    detail: "/ava-timeline-detail.webp",
    width: 1088,
    height: 405,
    alt: "Completed escrow timeline showing the hold, condition confirmation, and release",
  },
];

export default function Home() {
  return <main className="landing">
    <section className="hero" aria-labelledby="hero-title">
      <Image src="/ava-chamber.webp" alt="" fill priority unoptimized sizes="100vw" className="hero-image"/>
      <div className="hero-orb" aria-hidden="true"><VoiceOrb listening={false} large chamberLight/></div>
      <header className="marketing-nav wrap">
        <Brand/>
        <nav aria-label="Main navigation"><a href="#how">How it works</a><a href="#safety">Safety</a></nav>
      </header>
      <div className="hero-stage wrap">
        <div className="hero-copy">
          <h1 id="hero-title">Money on<br/>your terms</h1>
          <p className="hero-description">Tell Ava who to pay and when. Review the terms, then try the escrow flow with simulated USDC.</p>
          <div className="hero-actions">
            <Link className="button primary" href="/agent">Talk to Ava <ArrowUpRight size={16}/></Link>
          </div>
        </div>
      </div>
      <div className="hero-footer wrap"><a href="#how" className="text-link">How Ava works <ArrowDown size={15}/></a></div>
    </section>

    <section id="how" className="landing-section instruction-section">
      <Reveal>
        <div className="wrap instruction-content">
          <div>
            <h2>Start with a sentence</h2>
            <p>See how Ava turns an instruction into a payment you can review and release.</p>
          </div>
          <blockquote className="example-instruction">“{demoInstruction}”</blockquote>
        </div>
      </Reveal>
      <div className="wrap walkthrough">
        {walkthrough.map(step => <Reveal key={step.image}>
          <figure className={`walkthrough-step walkthrough-${step.tone}`}>
            <figcaption>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </figcaption>
            <a className="walkthrough-image" href={step.image} aria-label={`Open full-size screenshot: ${step.title}`}>
              <Image src={step.detail} width={step.width} height={step.height} unoptimized alt={step.alt}/>
              <ArrowUpRight className="walkthrough-expand" size={18} aria-hidden="true"/>
            </a>
          </figure>
        </Reveal>)}
        <p className="walkthrough-note">Screenshots show a simulated payment. No funds move on-chain.</p>
      </div>

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
