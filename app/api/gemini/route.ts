import { listActiveEvents, matchMarkets } from "../../../lib/gemini";
import { parseMarketCondition } from "../../../lib/gemini-condition";

export async function GET(request: Request) {
  const condition = new URL(request.url).searchParams.get("condition") ?? "";
  const query = condition.length <= 500 && parseMarketCondition(condition);
  if (!query) return Response.json({ error: "Enter a Gemini market condition." }, { status: 400 });
  try {
    const events = await listActiveEvents(query.query, query.next ? "crypto" : "");
    return Response.json({ choices: matchMarkets(events, condition) });
  } catch {
    return Response.json({ error: "Gemini market data is temporarily unavailable." }, { status: 502 });
  }
}
