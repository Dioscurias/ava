# Ava

Ava turns a natural-language payment instruction into a USDC escrow proposal that you can review, fund, and release in a simulated workspace. Built for the UBC Hackathon.

## Judge walkthrough

1. Open [Ava](https://ava-puce-xi.vercel.app), select **Talk to Ava**, and send **Check Solana Devnet** to verify live chain data.
2. Select **Hold a payment**, then send the instruction. Ava drafts a 250 USDC escrow for Maya Chen, with delivery of the final files as the release condition.
3. Check the recipient, amount, and condition, then select **Confirm demo escrow**. Open the new escrow.
4. Select **Mark condition met**, confirm, then select **Release funds** and confirm. The timeline records each step. The Activity page shows the completed payment.
5. In **Settings**, pause the agent and try confirming another draft. Ava blocks the action. Resume the agent to continue.

The walkthrough needs no wallet, microphone, or API key. State is stored in the current browser. An installed Solana wallet is optional and enables public-address display. The **Speak** control uses browser dictation. **Listen** and autoplay use Cartesia Sonic 3.6 with Skylar when the server-only `CARTESIA_API_KEY` is set in `.env.local` or in the Vercel Production environment. Set `CARTESIA_VOICE_ID` to use another voice. Redeploy after changing Production variables. Device speech remains available when Cartesia is unconfigured or unavailable.

## Agent decision loop and safety limits

1. Ava turns typed or spoken instructions into structured payment drafts. The local parser handles payment terms and corrections. The optional Grok API planner proposes edits for requests the parser cannot handle.
2. **Check Solana Devnet** asks the agent to read the current slot, check the Circle test USDC mint, and report whether Ava’s program is executable. The status API verifies the Devnet genesis hash before reporting the data. This works without a wallet or Grok key.
3. In Simulation, the user reviews and confirms the draft. The workspace checks the budget and permissions each time and stores escrow activity in the browser. Simulation never signs or broadcasts a payment.
4. In Devnet mode, an executable program and funded payer are prerequisites. The payer signs funding, manually attests to the condition, and signs release or cancel. The Rust program checks the spending cap, pause state, permissions, escrow state, and token accounts independently. Judge mode, when configured, uses a fixed recipient and 0.10 test USDC per escrow.

Model output cannot sign or broadcast. Gemini predictions can be attached to a draft preview. The preview displays live market data and blocks funding through that path. There is no automated settlement.

## Run locally

Use Node.js 22.

```sh
npm ci
npm test
npm run build
npm run dev
```

Open http://localhost:3000.

## Devnet escrow

The reserved Ava program address is `5oMajWiEnnKTELiZoBAWzqVeKXiQdrJ4PtFP8L82MeBB`. Deployment and sponsored transactions are unverified. The Circle test mint is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

The Rust program in `program/` holds Circle test USDC in a token account controlled by a program-derived address. The payer sets an on-chain spending cap and permissions, funds the escrow, signs a condition attestation, and signs or cancels release. The program checks the recipient, balance accounting, attestation, and pause setting independently of the browser. Conditions are manually attested by the payer. On-chain addresses, amounts, and conditions are public.

Set the Vercel build variable `NEXT_PUBLIC_AVA_DEVNET_PROGRAM` to the deployed Devnet program address to enable the Devnet tab. The app checks the Devnet genesis hash and that the configured program account is executable before requesting a transaction signature. Keep deployer and program keypairs outside Git. A live round trip needs a wallet funded with Devnet SOL, Circle test USDC, and a second wallet address. [Circle test USDC faucet](https://faucet.circle.com/).

### Test the on-chain program locally

With the Solana CLI, cargo-build-sbf, and solana-test-validator installed:

```sh
cargo build-sbf --manifest-path program/Cargo.toml
solana -u devnet program dump TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA /tmp/ava-spl-token.so
solana -u devnet program dump ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL /tmp/ava-spl-ata.so
AVA_TEST_TOKEN_PROGRAM=/tmp/ava-spl-token.so AVA_TEST_ATA_PROGRAM=/tmp/ava-spl-ata.so npm run test:program
```

The test starts its own validator and provides a local test mint fixture. It measures SPL token balances across funding, release, and cancellation, and verifies that unauthorized state transitions fail.

Judge mode and deployment instructions are in [docs/DEPLOYED.md](docs/DEPLOYED.md). The **Simulation / Devnet** switch keeps the browser-only walkthrough and the sponsored test-token flow separate.

### Grok planning

Set the server-only `XAI_API_KEY` in `.env.local` or in the Vercel environment and
redeploy. `XAI_MODEL` optionally overrides `grok-4-1-fast-non-reasoning`.
Ava uses Grok when the local parser and workspace commands cannot handle a message.
The current draft and up to four recent exchanges go to xAI on those turns.
Grok can propose edits or ask questions. Escrow confirmation remains an explicit
action in Ava. Set a spend limit on the provider key before enabling public traffic.

### Sponsor integrations

- **Gemini Prediction Markets** powers the BTC five-minute market draft preview. Ava reads Gemini’s public market API and shows the selected contract, bid/ask, and expiry.
- **QuickNode Streams** has a prototype filter and authenticated webhook. The configuration uses `solana-devnet` and `programs_with_logs`, filters for Ava program invocations, and sends signatures to a Vercel webhook that verifies them against RPC before recording timeline entries. Live delivery remains unverified. See the [Stream runbook](docs/quicknode-streams.md).
- **Voice** uses Cartesia in the deployed build. The Grok API planner is separate from Grok Bot on X.
