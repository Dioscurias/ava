# QuickNode Streams on Solana Devnet

**Devnet is high volume. Create an active Stream only for testing or a demo and pause it immediately afterward.** The filter limits webhook delivery, while QuickNode still processes the selected dataset.

## Configure

1. Deploy Ava with its executable Solana Devnet escrow program. For Judge mode, pre-fund the configured sponsor with Devnet SOL and test USDC. Set the same program address for the filter and the server.
2. Configure these server-side variables on Vercel. Keep the QuickNode management API key on your machine. Redeploy after setting variables.

| Variable | Where | Value |
| --- | --- | --- |
| `ESCROW_PROGRAM_ID` | Local and Vercel | Deployed Ava program address on Devnet |
| `AVA_DEVNET_RPC_URL` | Vercel | Solana Devnet RPC URL with transaction history access |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Vercel | Upstash Redis REST credentials |
| `QUICKNODE_WEBHOOK_SECRET` | Local and Vercel | Random secret for the webhook query parameter |
| `QUICKNODE_SECURITY_TOKEN` | Local and Vercel | A separate random secret for QuickNode’s HMAC |
| `QUICKNODE_API_KEY` | Local only | QuickNode API key with Streams access |
| `PUBLIC_BASE_URL` | Local only | Public HTTPS origin of the deployment |

Generate each webhook secret independently with `openssl rand -hex 32`. Store local values in the ignored `.env` file. The webhook route must be reachable by QuickNode without a Vercel login.

## Test and operate

Run these from the Ava root using Node 22.

```sh
npm ci
npm run typecheck
node --import tsx --test tests/*.test.ts
npm run test:streams
node --env-file-if-exists=.env --import tsx scripts/quicknode-stream.ts test-filter
node --env-file-if-exists=.env --import tsx scripts/quicknode-stream.ts create
```

Creation uses `solana-devnet`, `programs_with_logs`, and omits `start_range` to start at the latest block. Copy the returned Stream ID.

```sh
export STREAM_ID='paste-the-id-here'
node --env-file-if-exists=.env --import tsx scripts/quicknode-stream.ts status "$STREAM_ID"
```

Open `/devnet`; fund an escrow, attest its condition, and release. Check the release row for **QuickNode Stream** and click its Explorer link to confirm the Devnet signature. If RPC verifies first, the same row can show **RPC** until QuickNode delivery is independently verified. Open `/activity` within two minutes of a verified delivery to see the green health pill. The first 20 authenticated bodies up to 50 KiB are retained under `debug:qn:1` through `debug:qn:20`.

You can exercise QuickNode’s remote filter tester using the release slot from Explorer:

```sh
export RELEASE_SLOT='paste-the-slot-here'
node --env-file-if-exists=.env --import tsx scripts/quicknode-stream.ts test-filter "$RELEASE_SLOT"
node --env-file-if-exists=.env --import tsx scripts/quicknode-stream.ts pause "$STREAM_ID"
```

Use `resume "$STREAM_ID"` in a later demo or `delete "$STREAM_ID"` when finished. A paused Stream can catch up from its saved position. To start at the current head after a long pause, delete it and create a new Stream.

[Solana dataset and payload](https://www.quicknode.com/docs/streams/data-sources/solana) · [Webhook destination](https://www.quicknode.com/docs/streams/destinations/webhooks) · [REST API](https://www.quicknode.com/docs/streams/rest-api) · [OpenAPI](https://api.quicknode.com/streams/rest/openapi.json)
