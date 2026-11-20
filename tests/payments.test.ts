import {test} from "node:test";
import assert from "node:assert/strict";
import {parsePayment, guard, committed, initial, changeEscrow, conditionOutcome, displayCondition} from "../lib/payments.ts";

test("extracts a conditional payment and requires a recognizable amount and recipient", () => {
  assert.deepEqual(parsePayment("Send 250 USDC to Maya when she delivers the files."), {
    amount: 25000, recipient: "Maya", condition: "she delivers the files"
  });
  assert.equal(parsePayment("Send some USDC"), null);
  assert.equal(parsePayment("Send -25 USDC to Maya"), null);
});

test("paused and over-limit payments are blocked", () => {
  assert.match(guard({...initial, paused: true}, 100)!, /paused/i);
  assert.match(guard(initial, 1000000)!, /limit/i);
});

test("cancelling a hold frees capacity and terminal states cannot be changed", () => {
  const id = initial.escrows[0].id;
  const next = changeEscrow(initial, id, "cancel");
  assert.equal(next.escrows[0].status, "Cancelled");
  assert.equal(changeEscrow(next, id, "release"), next);
});

test("releasing requires workspace permission and recording a condition updates the timeline", () => {
  const id = initial.escrows[0].id;
  const ready = changeEscrow(initial, id, "verify");
  assert.equal(ready.escrows[0].status, "Ready to release");
  const restricted = {...ready, allowRelease: false};
  assert.equal(changeEscrow(restricted, id, "release"), restricted);
  const released = changeEscrow(ready, id, "release");
  assert.equal(released.escrows[0].status, "Completed");
  assert.equal(released.escrows[0].events.length, 3);
});

test("paused escrows refuse top-ups and cannot release until resumed", () => {
  const id = initial.escrows[0].id;
  const paused = changeEscrow(initial, id, "pause");
  assert.equal(changeEscrow(paused, id, "add", 500), paused);
  assert.equal(changeEscrow(paused, id, "release"), paused);
  const resumed = changeEscrow(paused, id, "resume");
  assert.equal(changeEscrow(resumed, id, "add", 500).escrows[0].amount, 45500);
});

test("drafts conversational requests and keeps missing terms for clarification", () => {
  assert.deepEqual(parsePayment("So I wanna make a payment Dave Chase the amount is $100 and that's his recipient so please"), {
    amount: 10000, recipient: "Dave Chase", condition: "You confirm the release"
  });
  assert.deepEqual(parsePayment("Could you pay Dave Chase $100 once the invoice arrives?"), {
    amount: 10000, recipient: "Dave Chase", condition: "the invoice arrives"
  });
  assert.equal(parsePayment("I want to pay Dave Chase"), null);
  assert.equal(parsePayment("Make a payment Dave Chase the amount is -$100"), null);
  assert.equal(parsePayment("Make a payment Dave Chase the amount is $100 or $120"), null);
});

test("activity groups conditions independently of payment status", () => {
  const [pending, ready, completed] = initial.escrows;
  assert.equal(conditionOutcome(pending), "Pending");
  assert.equal(conditionOutcome(ready), "Met");
  assert.equal(conditionOutcome(completed), "Met");
  const current = (state: typeof initial) => state.escrows.find(escrow => escrow.id === pending.id)!;
  assert.equal(conditionOutcome(current(changeEscrow(initial, pending.id, "release"))), "Unmet");
  assert.equal(conditionOutcome(current(changeEscrow(initial, pending.id, "cancel"))), "Unmet");
  const verified = changeEscrow(initial, pending.id, "verify");
  const paused = changeEscrow(verified, pending.id, "pause");
  assert.equal(conditionOutcome(current(paused)), "Met");
  assert.equal(conditionOutcome(current(changeEscrow(paused, pending.id, "resume"))), "Pending");
});


test("the simulation workspace minimum counts active escrows only", () => {
  assert.equal(committed(initial), 57_500);
  const pending = initial.escrows[0];
  const after = changeEscrow(initial, pending.id, "release");
  assert.equal(committed(after), 12_500);
  assert.equal(guard({...after, limit: 12_600}, 100), null);
});

test("older escrow conditions use payer language at display time", () => {
  assert.equal(displayCondition("I approve the design files"), "Payer approves the design files");
  assert.equal(displayCondition("Payer approves the design files"), "Payer approves the design files");
  assert.equal(displayCondition("Maya confirms that I approve"), "Maya confirms that I approve");
});
