import assert from "node:assert/strict";
import {test} from "node:test";
import {readPlan} from "../lib/ava-plan";

test("Grok can propose a partial draft without supplying prose", () => {
  assert.deepEqual(readPlan({intent: "draft", reply: "", amountCents: 7500, recipient: "", condition: ""}), {
    reply: "Review the proposed payment terms.",
    patch: {amount: 7500},
  });
});

test("Grok cannot propose an execution intent or invalid amount", () => {
  assert.equal(readPlan({intent: "execute", reply: "Send this now"}), null);
  assert.equal(readPlan({intent: "draft", reply: "Drafted.", amountCents: -1}), null);
});
