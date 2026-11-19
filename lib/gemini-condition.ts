export type Side = "yes" | "no";
export type MarketChoice = {
  ticker: string;
  title: string;
  instrumentSymbol: string;
  label: string;
  yesAsk: number | null;
  yesBid: number | null;
  expiryDate: string;
  side: Side;
};

export function parseMarketCondition(condition: string) {
  const next = condition.match(/^the next BTC 5[- ]minute round settles (up|down)$/i);
  if (next) return { query: "", next: true, side: (next[1].toLowerCase() === "up" ? "yes" : "no") as Side };
  const match = condition.match(/^(.+?) resolves (yes|no|up|down)$/i);
  if (!match) return null;
  const outcome = match[2].toLowerCase();
  return { query: match[1].trim(), next: false, side: (outcome === "yes" || outcome === "up" ? "yes" : "no") as Side, directional: outcome === "up" || outcome === "down" };
}
