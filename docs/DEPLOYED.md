# Ava Devnet deployment

**Status · Awaiting Devnet funding.** The program address below is reserved by the local program keypair. It has not been verified as executable on Devnet.

- Cluster: Solana Devnet
- Program address: `5oMajWiEnnKTELiZoBAWzqVeKXiQdrJ4PtFP8L82MeBB` ([Explorer](https://explorer.solana.com/address/5oMajWiEnnKTELiZoBAWzqVeKXiQdrJ4PtFP8L82MeBB?cluster=devnet))
- Program deployer: `8pcXey8fJxufZdzmG55uwhTvdKkGvbVTNnnZMsaiRwxB`
- Judge payer: `C5BaFb9LvFAEEeiSNLfG1YJea2GVwn1LQXBxhvhHq5cR`
- Judge recipient: `9EDxAfDvt5ms2kzCWBkaNGzST8qYZWUJ4jmK4Y6QhW5c`
- USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` ([Explorer](https://explorer.solana.com/address/4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU?cluster=devnet)), six decimals, owned by the classic SPL Token Program.

## Funding and deployment

The rent quote for the 106,984-byte timed-escrow build plus its 45-byte loader metadata was 0.54435756 SOL before fees. Request 1 **Devnet** SOL for the deployer and 0.5–1 Devnet SOL for the judge payer through the [Solana Devnet faucet](https://faucet.solana.com/). Use [Circle's testnet faucet](https://faucet.circle.com/) with Solana Devnet selected to supply at least 0.20 test USDC to the judge payer. The recipient needs no SOL to receive. The sponsor covers transaction and associated token account fees.

```sh
solana config set --url devnet
mkdir -p ~/.config/solana
# For a new deployer only. Use an existing funded Devnet signer if available.
solana-keygen new -o ~/.config/solana/ava-devnet-deployer.json
solana config set --keypair ~/.config/solana/ava-devnet-deployer.json
solana airdrop 1
solana balance
cargo build-sbf --manifest-path program/Cargo.toml
# Use the original program keypair here to retain an existing program ID.
AVA_PROGRAM_KEYPAIR=program/target/deploy/ava_escrow-keypair.json
AVA_PROGRAM_ID="$(solana-keygen pubkey "$AVA_PROGRAM_KEYPAIR")"
AVA_PROGRAM_BYTES="$(wc -c < program/target/deploy/ava_escrow.so | tr -d '[:space:]')"
solana rent "$((AVA_PROGRAM_BYTES + 45))"
solana program deploy --program-id "$AVA_PROGRAM_KEYPAIR" --max-len "$AVA_PROGRAM_BYTES" program/target/deploy/ava_escrow.so
solana program show "$AVA_PROGRAM_ID"
```

To retain the reserved address in this document, use the original keypair. On the development machine it was generated at `/tmp/ava-release.o6h3Eg/program/target/deploy/ava_escrow-keypair.json`. Back it up to private storage before cleaning temporary files. The corresponding deployer keypair is at `/tmp/ava-chain-keys/deployer.json`.

Ava uses the native Solana Rust entrypoint. The deployment keypair determines the program ID. This repo has no Anchor workspace, `Anchor.toml`, `declare_id!`, or generated Anchor IDL. The front end constructs instructions from the protocol in `lib/devnet.ts`.

- **Insufficient SOL:** Use the [Devnet faucet](https://faucet.solana.com/) if the CLI airdrop fails, then check `solana balance`. Run the rent check above against the new build. Use at least 1 Devnet SOL for the deployer.
- **Program ID mismatch:** Run `solana-keygen pubkey "$AVA_PROGRAM_KEYPAIR"`, verify that address with `solana program show`, and use it for both program variables below. Update any QuickNode filter that references the old program.
- **Wrong instructions or build:** Rebuild the Rust program from the same checkout. Ava’s handwritten client protocol replaces an Anchor IDL. Compare its opcodes and account layout against `program/src/lib.rs` if an instruction fails.

## Judge keys and token accounts

From the app root, using Node 22 after `npm ci`:

```sh
node --import tsx scripts/setup-judge.ts generate
solana airdrop 1 "$(solana-keygen pubkey ~/.config/solana/ava-judge/payer.json)"
node --env-file-if-exists=.env --import tsx scripts/setup-judge.ts accounts
node --import tsx scripts/setup-judge.ts print-secret
```

Fund the payer first. If the CLI airdrop fails, use the [Solana faucet](https://faucet.solana.com/). After creating the token accounts, select Solana Devnet in [Circle’s faucet](https://faucet.circle.com/) and send test USDC to the payer public address. The recipient needs no SOL. The script writes private files outside the repo by default. `print-secret` emits the payer JSON only when explicitly requested. Run it privately and paste the output directly into Vercel. Set `AVA_JUDGE_KEYS_DIR=/tmp/ava-judge-keys` to reuse the original test pair while those files are still available.

## App configuration

Set these Vercel **Production** variables, then redeploy Ava.

| Variable | Value |
| --- | --- |
| `ESCROW_PROGRAM_ID` | Deployed program address, used by the judge server. |
| `NEXT_PUBLIC_AVA_DEVNET_PROGRAM` | Same address for the browser wallet flow. |
| `JUDGE_PAYER_SECRET_KEY` | Payer JSON byte array printed by the script. Sensitive and server-only. |
| `JUDGE_RECIPIENT_PUBKEY` | Fixed recipient public address. |
| `SOLANA_RPC_URL` | Server Devnet RPC URL. The default is `https://api.devnet.solana.com`. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL for hourly and UTC daily caps. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token, server-only. |

Optional: `AVA_JUDGE_ACCESS_CODE` restricts the sponsor to invited judges. For local CLI work, `AVA_JUDGE_PAYER_KEYPAIR_PATH` can point to a local secret file. The old `AVA_DEVNET_PROGRAM`, `AVA_DEVNET_RPC_URL`, `AVA_JUDGE_PAYER_KEYPAIR`, and `AVA_JUDGE_RECIPIENT_ADDRESS` names are accepted as fallbacks.

Each run is 0.10 test USDC. The server allows three distinct funding requests per IP per UTC clock hour and ten per sponsor per UTC day, with a separate 5 USDC on-chain spending policy. Redis atomically reserves both quotas before broadcast. A failed broadcast can conservatively consume a slot. Retries with the same request ID reuse the daily reservation, and existing release or refund actions do not count toward quotas.

After redeploying, click **Run 0.10 USDC escrow** on `/devnet`. The click authorizes funding, attesting to the canned demo condition, and releasing to the fixed recipient. In **Draft a Devnet payment with Ava**, chat confirmation funds the fixed amount and recipient but leaves attestation manual for the custom condition. Check the Devnet Explorer links on the confirmed card and its payment detail page. The app keeps those receipts in the same browser session. Explorer links are public.

- `GET /api/devnet/status` reports the program address, cluster, verified mint, RPC health, and sponsor/recipient balances.
- `POST /api/devnet/fund`, `/attest`, `/release`, and `/cancel` return confirmed signatures and Devnet Explorer URLs. Create and fund are atomic and share one transaction signature.
- The browser keeps judge-session capabilities and confirmed receipts in session storage. Retry the same request after an uncertain confirmation to recover its existing signature.


## Wallet-signed delivery and review

From **Use your own wallet** on `/devnet`, connect a funded Devnet payer, set a spending limit, and draft `Hold 0.10 USDC for <recipient wallet> until I approve the files, give them 60 seconds to review.` Check the delivery deadline, select a distinct arbiter wallet if you want disputes, and fund. Open the funded escrow and share its `/payments/SOL-<address>` URL with the recipient and arbiter. Each signer needs Devnet SOL for transaction fees and, when necessary, to create the destination token account.

- **Claim:** Connect as the recipient and select **Mark delivered** before or at the deadline. At the end of the 60-second review window select **Claim USDC**. No payer approval or background job is required. Marking delivery is a recipient-signed assertion.
- **Refund:** Fund another escrow with a near delivery deadline. Leave delivery unmarked. After the deadline, connect as payer and select **Refund USDC**.
- **Dispute:** With a specified arbiter, mark another escrow delivered. Connect as the payer and select **Dispute delivery** before the review window ends. Then connect as the arbiter and select **Resolve and release** or **Resolve and refund**. A disputed escrow requires its configured arbiter to act. Decide on an arbiter both parties trust before funding.
- **Early release:** Connect as payer and select **Release early** while the escrow is funded or delivered and payer releases are enabled. Once a dispute opens, only the arbiter can move the funds.

Timed accounts use layout version 2 and preserve the existing v1 accounts and sponsored judge demo. The additional native opcodes are `5 fund_timed`, `6 mark_delivered`, `7 claim_after_review`, `8 refund_after_deadline`, `9 dispute`, and `10 resolve_dispute`. The shared payer release instruction remains opcode `3`. The native layout and transaction builders are in `lib/devnet.ts`. No additional environment variables are needed for wallet-signed timeouts or disputes.

For local validator coverage, build the SBF program and run `npm run test:program` with `AVA_TEST_VALIDATOR` pointing to `solana-test-validator` and `AVA_TEST_TOKEN_PROGRAM` and `AVA_TEST_ATA_PROGRAM` pointing to classic SPL Token and Associated Token Account program binaries. The integration test creates a local six-decimal fixture at the Devnet USDC mint address.
