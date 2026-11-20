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

const previewExpiry = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "long", timeZone: "UTC",
});

export function describeMarketPreview(condition: string, selected?: MarketChoice) {
  if (selected) {
    const expiry = new Date(selected.expiryDate);
    const timing = Number.isFinite(expiry.getTime()) ? ` It expires ${previewExpiry.format(expiry)}.` : "";
    return `“${selected.title}” is available to preview.${timing} This demo can’t fund a market-conditioned escrow.`;
  }
  const market = parseMarketCondition(condition);
  const label = market?.next ? "the next BTC 5-minute round" : `“${market?.query || condition}”`;
  return `I can preview ${label}. Market-conditioned funding is unavailable in this demo.`;
}

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
