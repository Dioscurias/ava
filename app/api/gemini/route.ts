import { listActiveEvents, matchMarkets } from "../../../lib/gemini";
import { parseMarketCondition } from "../../../lib/gemini-condition";

export async function GET(request: Request) {
  const condition = new URL(request.url).searchParams.get("condition") ?? "";
  const query = condition.length <= 500 && parseMarketCondition(condition);
  if (!query) return Response.json({ error: "Enter a Gemini market condition." }, { status: 400 });
  try {
    const events = await listActiveEvents("", query.next ? "crypto" : "", !query.next);
    let choices = matchMarkets(events, condition);
    // Next can return the old listing while it revalidates across a round boundary.
    if (query.next && choices.length === 0) {
      choices = matchMarkets(await listActiveEvents(query.query, "crypto", true), condition);
    }
    if (!query.next && choices.length === 0) {
      choices = matchMarkets(await listActiveEvents(query.query), condition);
    }
    return Response.json({choices}, {headers: {"Cache-Control": "no-store"}});
  } catch {
    return Response.json({ error: "Gemini market data is temporarily unavailable." }, { status: 502 });
  }
}
