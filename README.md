# Ava

Ava turns a natural-language payment instruction into a USDC escrow proposal that you can review, fund, and release in a simulated workspace. Built for the UBC Hackathon.

## Judge walkthrough

1. Open the deployed site and select **Talk to Ava**.
2. Select **Hold a payment**, then send the instruction. Ava drafts a 250 USDC escrow for Maya Chen, with delivery of the final files as the release condition.
3. Check the recipient, amount, and condition, then select **Confirm demo escrow**. Open the new escrow.
4. Select **Mark condition met**, confirm, then select **Release funds** and confirm. The timeline records each step. The Activity page shows the completed payment.
5. In **Settings**, pause the agent and try confirming another draft. Ava blocks the action. Resume the agent to continue.

The walkthrough needs no wallet, microphone, or API key. State is stored in the current browser. An installed Solana wallet is optional and enables public-address display. Voice dictation uses browser speech recognition when available.

## Simulation boundary

The public demo does not custody, sign, broadcast, or receive transfers. An instruction parser drafts payment terms, the user's confirmation supplies the simulated condition evidence, and browser state models escrow and limits. A Solana wallet connection does not change those behaviors. A live release would require a deployed escrow program, server-side policy and evidence verification, and wallet authorization. Grok and ElevenLabs are integration targets.

## Run locally

Use Node.js 22.

```sh
npm ci
npm test
npm run build
npm run dev
```

Open http://localhost:3000.
