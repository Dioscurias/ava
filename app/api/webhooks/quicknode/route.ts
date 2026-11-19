import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { after } from "next/server";
import { recordSignature, redis, redisEnabled, signaturePattern } from "../../../../lib/stream-events.server";

export const runtime = "nodejs";
export const maxDuration = 60;

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const receivedAt = Date.now();
  const key = process.env.QUICKNODE_WEBHOOK_SECRET;
  const token = process.env.QUICKNODE_SECURITY_TOKEN;
  const nonce = request.headers.get("x-qn-nonce");
  const timestamp = request.headers.get("x-qn-timestamp");
  const signature = request.headers.get("x-qn-signature");
  const unauthorized = () => new Response(null, {status: 401});
  if (!key || !token || !equal(new URL(request.url).searchParams.get("k") ?? "", key) ||
      !nonce || nonce.length > 200 || !timestamp || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return unauthorized();
  const seconds = Number(timestamp);
  const signedAt = seconds < 1e12 ? seconds * 1000 : seconds;
  if (!Number.isFinite(signedAt) || Math.abs(receivedAt - signedAt) > 300_000) return unauthorized();
  let raw: Buffer;
  try {
    raw = Buffer.from(await request.arrayBuffer());
    if (raw[0] === 31 && raw[1] === 139) raw = gunzipSync(raw, {maxOutputLength: 512_000});
    if (raw.length > 512_000) return new Response(null, {status: 413});
  } catch {
    return new Response(null, {status: 400});
  }
  const expected = createHmac("sha256", token).update(nonce + timestamp).update(raw).digest("hex");
  if (!equal(signature.toLowerCase(), expected)) return unauthorized();
  if (!redisEnabled()) return new Response(null, {status: 503});
  let value;
  try { value = JSON.parse(raw.toString("utf8")); }
  catch { return new Response(null, {status: 400}); }
  const rows = Array.isArray(value) ? value : value?.data;
  if (!Array.isArray(rows)) return new Response(null, {status: 400});
  after(async () => {
    try {
      if (!await redis("SET", "ava:qn:nonce:" + nonce, "1", "EX", 600, "NX")) return;
      if (raw.length <= 50 * 1024) await redis("EVAL", `
        local n=tonumber(redis.call('get', KEYS[1]) or '0')
        if n<20 then
          redis.call('set', 'debug:qn:'..(n+1), ARGV[1])
          redis.call('incr', KEYS[1])
        end
      `, 1, "debug:qn:count", raw.toString("utf8"));
      const signatures = [...new Set<string>(rows.flatMap(row =>
        typeof row?.signature === "string" && signaturePattern.test(row.signature) ? [row.signature] : []))];
      for (let index = 0; index < signatures.length; index += 8) {
        await Promise.allSettled(signatures.slice(index, index + 8).map(sig => recordSignature(sig, "stream", receivedAt)));
      }
    } catch {
      console.error("QuickNode webhook processing failed");
    }
  });
  return new Response(null, {status: 200});
}
