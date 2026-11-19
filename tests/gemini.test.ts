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
