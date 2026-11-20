import { parseMarketCondition, type MarketChoice } from "./gemini-condition";

type Contract = {
  instrumentSymbol: string;
  label: string;
  prices?: { buy?: { yes?: string }; sell?: { yes?: string } };
  status: string;
  marketState: string;
  expiryDate: string;
  resolutionSide?: string;
  resolvedAt?: string;
};
type Event = { ticker: string; title: string; contracts: Contract[] };
type EventList = { data: Event[] };

function quote(value?: string) {
  const price = value ? Number(value) : NaN;
  return Number.isFinite(price) && price >= 0 && price <= 1 ? price : null;
}

export function normalizeContract(contract: Contract) {
  const { instrumentSymbol, label, status, marketState, expiryDate, resolutionSide, resolvedAt } = contract;
  return {
    instrumentSymbol, label, status, marketState, expiryDate, resolutionSide, resolvedAt,
    yesAsk: quote(contract.prices?.buy?.yes),
    yesBid: quote(contract.prices?.sell?.yes),
  };
}

async function read<T>(path: string, fresh = false): Promise<T> {
  const response = await fetch(`https://api.gemini.com/v1/prediction-markets/events${path}`, {
    ...(fresh ? {cache: "no-store"} : {next: {revalidate: 5}}),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}`);
  return response.json();
}

export async function listActiveEvents(q = "", category = "", fresh = false) {
  const query = new URLSearchParams({ status: "active", limit: category === "crypto" ? "500" : "50" });
  if (q) query.set("search", q);
  if (category) query.set("category", category);
  return (await read<EventList>(`?${query}`, fresh)).data;
}

export function getEvent(ticker: string) {
  return read<Event>(`/${encodeURIComponent(ticker)}`);
}

export function matchMarkets(events: Event[], condition: string, now = Date.now()): MarketChoice[] {
  const request = parseMarketCondition(condition);
  if (!request) return [];
  const results = events.flatMap(event => event.contracts.flatMap(raw => {
    const contract = normalizeContract(raw);
    if (contract.status !== "active" || contract.marketState !== "open" || !(Date.parse(contract.expiryDate) > now)) return [];
    if (request.next && !contract.instrumentSymbol.includes("BTC05M")) return [];
    if ((request.next || request.directional) && contract.label.toLowerCase() !== "up") return [];
    return [{ ...contract, ticker: event.ticker, title: event.title, side: request.side }];
  }));
  if (!request.next || !results.length) return results;
  const earliest = Math.min(...results.map(result => Date.parse(result.expiryDate)));
  return results.filter(result => Date.parse(result.expiryDate) === earliest);
}
