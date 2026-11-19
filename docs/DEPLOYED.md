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
cargo build-sbf --manifest-path program/Cargo.toml
solana --url devnet --keypair ~/.config/solana/ava-devnet-deployer.json program deploy \
  --program-id ~/.config/solana/ava-devnet-program.json \
  --max-len 98000 program/target/deploy/ava_escrow.so
solana --url devnet --keypair ~/.config/solana/ava-devnet-deployer.json program show \
  5oMajWiEnnKTELiZoBAWzqVeKXiQdrJ4PtFP8L82MeBB
npm run devnet:roundtrip
```

## App configuration

Put the program address in `AVA_DEVNET_PROGRAM` and `NEXT_PUBLIC_AVA_DEVNET_PROGRAM` in the ignored local `.env`. Use the public variable for the wallet-signed browser path. Set `AVA_JUDGE_PAYER_KEYPAIR_PATH` and `AVA_JUDGE_RECIPIENT_KEYPAIR_PATH` to the private local files. For Vercel, store the two raw JSON keypair arrays in server-only sensitive variables `AVA_JUDGE_PAYER_KEYPAIR` and `AVA_JUDGE_RECIPIENT_KEYPAIR`, or keep Judge mode unavailable on the hosted app. Never add these keypairs to Git. Use a dedicated Devnet RPC with `AVA_DEVNET_RPC_URL` if needed.

Each sponsored escrow uses 0.10 test USDC and the fixed judge recipient. The initial on-chain spending cap is 5 test USDC. The server stops new funding when the payer has less than 0.02 SOL. Set `AVA_JUDGE_ACCESS_CODE` to restrict access to invited judges without requiring a wallet. Judge conditions and transaction addresses are public. The user attests to the condition before release.

- `GET /api/devnet/status` reports the program address, cluster, verified mint, RPC health, and sponsor/recipient balances.
- `POST /api/devnet/fund`, `/attest`, `/release`, and `/cancel` return confirmed signatures and Devnet Explorer URLs. Create and fund are atomic and share one transaction signature.
- The browser keeps judge-session capabilities and confirmed receipts in session storage. Retry the same request after an uncertain confirmation to recover its existing signature.
