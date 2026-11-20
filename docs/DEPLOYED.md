# Ava Devnet deployment

**Status · Awaiting Devnet funding.** The program address below is reserved by the local program keypair. It has not been verified as executable on Devnet.

- Cluster: Solana Devnet
- Program address: `5oMajWiEnnKTELiZoBAWzqVeKXiQdrJ4PtFP8L82MeBB` ([Explorer](https://explorer.solana.com/address/5oMajWiEnnKTELiZoBAWzqVeKXiQdrJ4PtFP8L82MeBB?cluster=devnet))
- Program deployer: `8pcXey8fJxufZdzmG55uwhTvdKkGvbVTNnnZMsaiRwxB`
- Judge payer: `C5BaFb9LvFAEEeiSNLfG1YJea2GVwn1LQXBxhvhHq5cR`
- Judge recipient: `9EDxAfDvt5ms2kzCWBkaNGzST8qYZWUJ4jmK4Y6QhW5c`
- USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` ([Explorer](https://explorer.solana.com/address/4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU?cluster=devnet)), six decimals, owned by the classic SPL Token Program.

## Funding and deployment

The rent quote for a 98,000-byte program was approximately 0.50 SOL before fees. Request 1 **Devnet** SOL for the deployer and 0.5–1 Devnet SOL for the judge payer through the [Solana Devnet faucet](https://faucet.solana.com/). Use [Circle's testnet faucet](https://faucet.circle.com/) with Solana Devnet selected to supply at least 0.20 test USDC to the judge payer. The recipient needs no SOL to receive. The sponsor covers transaction and associated token account fees.

```sh
solana config set --url devnet
# Run these keygen commands only for fresh wallets. Reuse the original
# deployer and program files if you want to keep the reserved address.
umask 077
solana-keygen new -o ~/.config/solana/ava-devnet-deployer.json
solana-keygen new -o ~/.config/solana/ava-judge-payer.json
solana-keygen new -o ~/.config/solana/ava-judge-recipient.json
solana-keygen pubkey ~/.config/solana/ava-judge-payer.json
solana-keygen pubkey ~/.config/solana/ava-judge-recipient.json
solana airdrop 1 "$(solana-keygen pubkey ~/.config/solana/ava-devnet-deployer.json)"
solana airdrop 1 "$(solana-keygen pubkey ~/.config/solana/ava-judge-payer.json)"
cargo build-sbf --manifest-path program/Cargo.toml
# Keep program/target/deploy/ava_escrow-keypair.json safe. If using the existing
# reserved keypair, set --program-id to that original keypair file instead.
solana --url devnet --keypair ~/.config/solana/ava-devnet-deployer.json program deploy \
  --program-id program/target/deploy/ava_escrow-keypair.json \
  --max-len 98000 program/target/deploy/ava_escrow.so
solana-keygen pubkey program/target/deploy/ava_escrow-keypair.json
solana --url devnet --keypair ~/.config/solana/ava-devnet-deployer.json program show YOUR_PROGRAM_ID
npm run devnet:roundtrip
```

Ava uses the native Solana Rust entrypoint. It does not have an Anchor workspace, `Anchor.toml`, or `declare_id!`. The deployment keypair determines the program ID. When deploying to a new address, update the two program variables below and any QuickNode filter that references the old address. If CLI airdrops fail, use the linked Solana faucet and verify both balances before deploying.

## App configuration

Set these Vercel **Production** variables, then redeploy Ava.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_AVA_DEVNET_PROGRAM` | Public deployed Devnet program address for wallet-signed flows and the server default. |
| `AVA_JUDGE_PAYER_KEYPAIR` | The payer keypair JSON byte array from the local file. Store as sensitive, server-only. |
| `AVA_JUDGE_RECIPIENT_ADDRESS` | Fixed judge recipient public address. Ava does not need the recipient’s secret. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL for the UTC daily cap. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token, server-only. |

Optional: `AVA_DEVNET_PROGRAM` is a server-side override and must match the public value if set. `AVA_DEVNET_RPC_URL` overrides the public Devnet RPC. `AVA_JUDGE_ACCESS_CODE` restricts sponsor access. For local CLI work, prefer `AVA_JUDGE_PAYER_KEYPAIR_PATH` over storing keypair data in the environment. Store secret files outside Git. For Circle test USDC, use the payer’s public address at the [Circle faucet](https://faucet.circle.com/) with Solana Devnet selected.

Each sponsored escrow uses 0.10 test USDC, with at most ten distinct funding requests per UTC day per sponsor (1.00 USDC total) and a separate 5 USDC on-chain spending policy. Redis atomically reserves each request before broadcast. A failed broadcast can conservatively consume a slot, and retries with the same request ID reuse the reservation. Existing escrow release and cancellation do not consume a daily slot. Conditions and transaction addresses are public. The payer attests to the condition before release.

From `/devnet`, use **Create and fund 0.10 test USDC** or open **Draft a Devnet payment with Ava**. In chat, review the fixed funded amount and demo recipient before confirming. Open the funding, attestation, and release signatures in Explorer. Verify that Simulation still saves a browser-only draft.

- `GET /api/devnet/status` reports the program address, cluster, verified mint, RPC health, and sponsor/recipient balances.
- `POST /api/devnet/fund`, `/attest`, `/release`, and `/cancel` return confirmed signatures and Devnet Explorer URLs. Create and fund are atomic and share one transaction signature.
- The browser keeps judge-session capabilities and confirmed receipts in session storage. Retry the same request after an uncertain confirmation to recover its existing signature.
