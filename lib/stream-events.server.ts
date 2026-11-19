import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { devnetGenesis } from "./devnet";


export const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const kinds = [null, "fund", "attest", "release", "cancel"] as const;
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const prefix = "ava:devnet:stream:";
const expiry = 60 * 60 * 24 * 30;

export function redisEnabled() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export async function redis<T>(...command: (string | number)[]): Promise<T> {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL!, {
    method: "POST",
    headers: {authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "content-type": "application/json"},
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Timeline storage HTTP ${response.status}`);
  const {result, error} = await response.json();
  if (error) throw new Error("Timeline storage command failed");
  return result;
}

export function eventRpc() {
  return new Connection(process.env.AVA_DEVNET_RPC_URL || clusterApiUrl("devnet"), {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (url, init) => fetch(url, {...init, signal: AbortSignal.timeout(5_000)}),
  });
}

function decodeInstruction(data: string) {
  let value = 0n;
  for (const char of data) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) return Buffer.alloc(0);
    value = value * 58n + BigInt(digit);
  }
  const hex = value ? value.toString(16) : "";
  return Buffer.concat([Buffer.alloc(data.match(/^1*/)?.[0].length ?? 0), Buffer.from(hex.padStart(hex.length + hex.length % 2, "0"), "hex")]);
}

export async function recordSignature(signature: string, source: "stream" | "rpc", seenAt = Date.now(), submittedAt?: number) {
  const address = process.env.ESCROW_PROGRAM_ID || process.env.AVA_DEVNET_PROGRAM || process.env.NEXT_PUBLIC_AVA_DEVNET_PROGRAM;
  if (!signaturePattern.test(signature) || !redisEnabled() || !address) return;
  const key = prefix + "tx:" + signature;
  const lock = key + ":lock";
  const token = crypto.randomUUID();
  const saved = await redis("GET", key);
  if (saved && (source === "rpc" || saved === "stream")) return;
  let acquired = await redis("SET", lock, token, "NX", "EX", 25);
  for (let attempt = 0; !acquired && source === "stream" && attempt < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    if (await redis("GET", key) === "stream") return;
    acquired = await redis("SET", lock, token, "NX", "EX", 25);
  }
  if (!acquired) return;
  try {
    const existing = await redis("GET", key);
    if (existing && (source === "rpc" || existing === "stream")) return;
    const connection = eventRpc();
    if (await connection.getGenesisHash() !== devnetGenesis) return;
    const tx = await connection.getParsedTransaction(signature, {commitment: "confirmed", maxSupportedTransactionVersion: 0});
    if (!tx?.meta || tx.meta.err) return;
    const program = new PublicKey(address);
    const submitted = submittedAt ?? await redis<string | null>("GET", prefix + "submit:" + signature);
    const events = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap(group => group.instructions)].flatMap(ix => {
      if (!ix.programId.equals(program) || !("data" in ix) || ix.accounts.length < 3) return [];
      const data = decodeInstruction(ix.data);
      const kind = kinds[data[0]];
      if (!kind || data.length < 9) return [];
      const [payer, , escrow] = ix.accounts;
      const [expected] = PublicKey.findProgramAddressSync([Buffer.from("escrow"), payer.toBuffer(), data.subarray(1, 9)], program);
      if (!expected.equals(escrow)) return [];
      return [{kind, signature, escrow: escrow.toBase58(), source, slot: tx.slot,
        latencyMs: submitted == null ? null : Math.max(0, seenAt - Number(submitted))}];
    });
    if (!events.length) return;
    await redis("EVAL", `
      if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
      local previous = redis.call('get', KEYS[2])
      if previous == 'stream' or (previous and ARGV[2] == 'rpc') then return 0 end
      for i=4,#KEYS do
        local found = false
        if previous == 'rpc' then
          local new = cjson.decode(ARGV[i])
          for index, row in ipairs(redis.call('lrange', KEYS[i], 0, 99)) do
            local old = cjson.decode(row)
            if old.signature == new.signature and old.kind == new.kind and old.source == 'rpc' then
              redis.call('lset', KEYS[i], index-1, ARGV[i])
              found = true
              break
            end
          end
        end
        if not found then
          redis.call('lpush', KEYS[i], ARGV[i])
          redis.call('ltrim', KEYS[i], 0, 99)
        end
        redis.call('expire', KEYS[i], ARGV[3])
      end
      redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3])
      if ARGV[2] == 'stream' then redis.call('set', KEYS[3], ARGV[#KEYS+1], 'EX', 120) end
      return 1
    `, 3 + events.length, lock, key, prefix + "last",
    ...events.map(event => prefix + "escrow:" + event.escrow),
    token, source, expiry, ...events.map(event => JSON.stringify(event)), seenAt);
  } finally {
    await redis("EVAL", "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end", 1, lock, token);
  }
}

export async function recordSubmission(signature: string, at: number) {
  if (!redisEnabled() || !signaturePattern.test(signature)) return;
  const accepted = await redis("SET", prefix + "submit:" + signature, at, "NX", "EX", 600);
  if (!accepted) return;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, at + 6_000 - Date.now())));
  await recordSignature(signature, "rpc", Date.now(), at);
}

export async function readTimeline(escrow?: string) {
  if (!redisEnabled()) return {healthy: false, events: []};
  const [last, events] = await Promise.all([
    redis<string | null>("GET", prefix + "last"),
    escrow ? redis<string[]>("LRANGE", prefix + "escrow:" + new PublicKey(escrow).toBase58(), 0, 99) : [],
  ]);
  return {healthy: last != null && Date.now() - Number(last) < 120_000, events: events.map(value => JSON.parse(value))};
}
