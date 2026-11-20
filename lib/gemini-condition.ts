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

export const marketPreviewMessage = "Market conditions are preview-only in this demo.";

export function normalizeMarketTitle(title: string) {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function parseMarketCondition(condition: string) {
  const text = condition.trim().replace(/^(?:if|until|when)\s+/i, "").replace(/[.!?]+$/, "");
  const next = text.match(/^the next BTC 5[- ]minute round settles (up|down)$/i);
  if (next) return {query: "", next: true, side: (next[1].toLowerCase() === "up" ? "yes" : "no") as Side, directional: true};
  const match = text.match(/^(.+?)\s+(?:(?:resolves|settles)(?:\s+(yes|no|up|down))?|happens)$/i);
  if (!match) return null;
  const outcome = match[2]?.toLowerCase() ?? "yes";
  const upSuffix = /\s*·\s*up\s*$/i;
  const query = match[1].replace(upSuffix, "").trim();
  if (!normalizeMarketTitle(query)) return null;
  return {query, next: false, side: (outcome === "yes" || outcome === "up" ? "yes" : "no") as Side, directional: upSuffix.test(match[1]) || outcome === "up" || outcome === "down"};
}
