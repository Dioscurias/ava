import assert from "node:assert/strict";
import {test} from "node:test";
import {changeEscrow, initial, parsePayment} from "../lib/payments";
import {draftTurn, emptyDraft, readyDraft} from "../lib/draft-memory";
import {applyWorkspaceOperation, parseWorkspaceOperation} from "../lib/workspace-operations";

const id = "AL-" + "A".repeat(32);
const now = Date.UTC(2026,10,21,12);
const schedule = parseWorkspaceOperation({type:"create", id, draft:{amount:500,recipient:"Maya Chen",condition:"in 30 seconds"}});
const releaseDue = parseWorkspaceOperation({type:"release-due", now:9999999999999});

test("scheduled payment phrases keep the named recipient and the whole schedule", () => {
  assert.deepEqual(parsePayment("Hold 5 USDC for Maya Chen in 30 seconds"), {amount:500,recipient:"Maya Chen",condition:"in 30 seconds"});
  assert.equal(readyDraft(draftTurn(emptyDraft,"Hold five USDC for Maya Chen in 30 seconds")!.memory)?.condition,"in 30 seconds");
  assert.equal(readyDraft(draftTurn(emptyDraft,"Hold 5 USDC for Maya Chen until she delivers")!.memory)?.condition,"she delivers");
});

test("a confirmed countdown starts at funding and releases once at the server clock", () => {
  const funded = applyWorkspaceOperation(initial,schedule,now);
  assert.equal(funded.escrows[0].releaseAt,now+30_000);
  assert.equal(applyWorkspaceOperation(funded,releaseDue,now+29_999),funded);
  const released = applyWorkspaceOperation(funded,releaseDue,now+30_000);
  assert.equal(released.escrows[0].status,"Completed");
  assert.equal(released.escrows[0].events.at(-1)?.label,"Automatic release · scheduled time reached");
  assert.equal(applyWorkspaceOperation(released,releaseDue,now+31_000),released);
});

test("manual, cancelled, and paused escrows are protected", () => {
  const funded = applyWorkspaceOperation(initial,schedule,now);
  const cancelled = changeEscrow(funded,id,"cancel");
  const paused = changeEscrow(funded,id,"pause");
  const due = now+30_000;
  for (const state of [initial,cancelled,paused,{...funded,paused:true},{...funded,allowRelease:false}]) {
    assert.equal(applyWorkspaceOperation(state,releaseDue,due),state);
  }
});

test("past and ambiguous schedules cannot silently auto-release", () => {
  const old = parseWorkspaceOperation({type:"create",id,draft:{amount:500,recipient:"Maya",condition:"2026-11-20T12:00:00Z"}});
  assert.throws(() => applyWorkspaceOperation(initial,old,now),/future/);
  const manual = parseWorkspaceOperation({type:"create",id,draft:{amount:500,recipient:"Maya",condition:"she delivers the files tomorrow"}});
  assert.equal(applyWorkspaceOperation(initial,manual,now).escrows[0].releaseAt,undefined);
});
