import assert from "node:assert/strict";
import { test } from "node:test";
import btc from "../docs/gemini-samples/btc05m-active.json";
import active from "../docs/gemini-samples/active.json";
import settled from "../docs/gemini-samples/settled.json";
import { matchMarkets, normalizeContract } from "../lib/gemini";

const now = Date.parse(btc.contracts[0].expiryDate) - 1;

test("the BTC shortcut uses Gemini's actual instrument and direction", () => {
  const result = matchMarkets([btc], "the next BTC 5-minute round settles down", now);
  assert.equal(result.length, 1);
  assert.equal(result[0].instrumentSymbol, btc.contracts[0].instrumentSymbol);
  assert.equal(result[0].side, "no");
});

test("a categorical event offers distinct choices", () => {
  const event = active.data.find(item => item.contracts.filter(contract => contract.status === "active" && contract.marketState === "open").length > 1);
  assert.ok(event);
  assert.ok(matchMarkets([event], `${event.title} resolves yes`, 0).length > 1);
});

test("a round that has expired is excluded", () => {
  assert.deepEqual(matchMarkets([btc], "the next BTC 5-minute round settles up", now + 1), []);
});

test("quotes can be absent on a settled contract", () => {
  const contract = normalizeContract(settled.contracts[0]);
  assert.equal(contract.status, "settled");
  assert.equal(contract.marketState, "closed");
  assert.equal(contract.yesAsk, null);
  assert.equal(contract.resolutionSide, settled.contracts[0].resolutionSide);
  assert.ok(contract.resolvedAt);
});

test("the BTC lookup refreshes an expired cached round", async (t) => {
  const route = await import("../app/api/gemini/route");
  const expiryDate = new Date(Date.now() + 60_000).toISOString();
  const fresh = {...btc, contracts: [{...btc.contracts[0], expiryDate}]};
  const fetch = t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, options?: RequestInit) =>
    Response.json({data: [options?.cache === "no-store" ? fresh : {...btc, contracts: [{...btc.contracts[0], expiryDate: "2000-01-01T00:00:00Z"}]}]}));
  const url = new URL("http://localhost/api/gemini");
  url.searchParams.set("condition", "the next BTC 5-minute round settles up");
  const response = await route.GET(new Request(url));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0]?.expiryDate, expiryDate);
  assert.equal(fetch.mock.callCount(), 2);
});

test("condition phrases handle if, when, and a copied Up suffix", () => {
  const title = btc.title.toUpperCase().replace(/:/g, " ");
  for (const [condition, side] of [
    [`if ${title} · Up resolves no`, "no"],
    [`if ${title} happens`, "yes"],
    [`when ${title} settles`, "yes"],
    [`until ${title} settles down`, "no"],
  ]) {
    const [choice] = matchMarkets([btc], condition, now);
    assert.equal(choice?.instrumentSymbol, btc.contracts[0].instrumentSymbol);
    assert.equal(choice?.expiryDate, btc.contracts[0].expiryDate);
    assert.equal(choice?.side, side);
  }
  assert.deepEqual(matchMarkets([btc], "if an unrelated market resolves yes", now), []);
});

test("YES ask is the buy quote and YES bid is the sell quote", () => {
  const {yesAsk, yesBid} = normalizeContract(btc.contracts[0]);
  assert.equal(yesAsk, Number(btc.contracts[0].prices.buy.yes));
  assert.equal(yesBid, Number(btc.contracts[0].prices.sell.yes));
  assert.ok(yesAsk! > yesBid!);
});

test("matching titles keep different contract expiries or tenors selectable", () => {
  const other = {...btc, ticker: "other-market", contracts: [{...btc.contracts[0], instrumentSymbol:"other-instrument"}]};
  const result = matchMarkets([btc, other], `if ${btc.title} · Up resolves yes`, now);
  assert.deepEqual(result.map(choice => choice.instrumentSymbol), [btc.contracts[0].instrumentSymbol, "other-instrument"]);
});
