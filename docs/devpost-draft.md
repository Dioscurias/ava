# Ava | UBC 2026 submission draft

**Elevator pitch**
Tell Ava who to pay and when. She turns spoken or typed instructions into reviewable USDC escrow drafts with spending limits, release conditions, and a payment trail.

**Main track**
Agentic Payments and AI

**Chain award**
Best use of Solana, if the Devnet escrow program is deployed and demonstrated.

**Bounties**
Gemini Prediction Markets, once the live market preview is checked. Keep QuickNode Streams off until there is a configured Stream delivering live events. The current build uses Cartesia voice and the Grok API rather than Grok Bot on X.

## What did you build?

Ava is a voice-first workspace for drafting and reviewing conditional USDC payments. Tell Ava the amount, recipient, and what needs to happen before the payment is released. It puts those terms into a draft and asks you to review them.

## What problem does it solve?

Payment tools usually ask you to send immediately. For a contractor milestone or an invoice, you often want to agree on the terms first and release funds only after delivery. Ava gives that agreement a clear review step and a payment history.

## How does it work?

Ava parses typed or spoken instructions and keeps corrections in one draft. Simulation lets you try funding, attesting, releasing, and pausing without a wallet. The agent can also read Solana Devnet directly to check chain and mint status. A native Rust escrow program supports a separate Devnet flow with wallet signatures, payer attestation, and on-chain spending controls when deployed.

## What makes it unique?

Ava makes a conditional payment as easy to draft as a conversation. You can correct an amount or change a recipient before confirming. The app also previews real Gemini Prediction Markets contracts so you can see how an outcome could be expressed as a release condition.

## What would you build next?

Deploy and verify the on-chain escrow flow, add explicit authorization for settlement evidence, and connect the resulting payment events to a live timeline. Then support service payments where an agent can safely pay for an API call under a predefined budget.

## Technologies

Next.js, TypeScript, React, Solana, native Rust, SPL Token, Circle test USDC, Cartesia Sonic, Gemini Prediction Markets API.

## Demo video | 2 minutes 20 seconds

- **0:00–0:20** Show the landing orb and explain why a payment might need a release condition.
- **0:20–0:55** Speak a draft for 100 USDC. Correct it to 75 USDC and show the updated amount before confirming.
- **0:55–1:25** In Simulation, fund, attest, and release. Open Activity and show the result. Label the flow as simulated.
- **1:25–1:55** Ask Ava to check Solana Devnet. Show the live slot and verified test USDC mint. If a real escrow round trip is ready, show its confirmed Explorer transaction here.
- **1:55–2:20** Show spending limits and the pause control. If the Gemini preview is available, briefly show how the selected market appears on the draft.

## Before submitting

- Verify the public visibility of the GitHub repository and include its URL.
- Add all team members and a judge-accessible YouTube or Drive video link.
- Confirm the deployed app and select one main track, at most one chain award, and only the demonstrated bounties.
