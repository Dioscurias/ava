import { after } from "next/server";

import { readTimeline, recordSubmission, signaturePattern } from "../../../../lib/stream-events.server";

export async function GET(request: Request) {
  try {
    return Response.json(await readTimeline(new URL(request.url).searchParams.get("escrow") ?? undefined),
      {headers: {"cache-control": "no-store"}});
  } catch {
    return Response.json({healthy: false, events: []}, {status: 503});
  }
}

export const maxDuration = 30;

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") !== "same-origin" ||
      !request.headers.get("content-type")?.startsWith("application/json")) {
    return new Response(null, {status: 403});
  }
  const payload = await request.json().catch(() => null);
  if (typeof payload?.signature !== "string" || !signaturePattern.test(payload.signature)) {
    return new Response(null, {status: 400});
  }
  const at = Date.now();
  after(() => recordSubmission(payload.signature, at).catch(() => console.error("Devnet timeline fallback failed")));
  return new Response(null, {status: 202});
}
