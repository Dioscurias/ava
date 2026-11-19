# Ava

Ava turns a natural-language payment instruction into a USDC escrow proposal that you can review, fund, and release in a simulated workspace. Built for the UBC Hackathon.

## Judge walkthrough

1. Open the deployed site and select **Talk to Ava**.
2. Select **Hold a payment**, then send the instruction. Ava drafts a 250 USDC escrow for Maya Chen, with delivery of the final files as the release condition.
3. Check the recipient, amount, and condition, then select **Confirm demo escrow**. Open the new escrow.
4. Select **Mark condition met**, confirm, then select **Release funds** and confirm. The timeline records each step. The Activity page shows the completed payment.
5. In **Settings**, pause the agent and try confirming another draft. Ava blocks the action. Resume the agent to continue.

The walkthrough needs no wallet, microphone, or API key. State is stored in the current browser. An installed Solana wallet is optional and enables public-address display. The **Speak** control uses browser dictation. **Listen** uses the ElevenLabs Sarah voice when the server-only `ELEVENLABS_API_KEY` is set. Set `ELEVENLABS_VOICE_ID` to override Sarah. Browser playback remains available when ElevenLabs is unconfigured or unavailable. Use a text-to-speech-scoped key with a provider credit limit for public demos.

## Simulation boundary

The public demo does not custody, sign, broadcast, or receive transfers. An instruction parser drafts payment terms, the user's confirmation supplies the simulated condition evidence, and browser state models escrow and limits. A Solana wallet connection does not change those behaviors. A live release would require a deployed escrow program, server-side policy and evidence verification, and wallet authorization. Grok remains an integration target.

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
