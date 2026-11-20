import assert from "node:assert/strict";
import {test} from "node:test";
import {initial} from "../lib/payments";
import {applyWorkspaceOperation, parseWorkspaceOperation, WorkspaceError} from "../lib/workspace-operations";

const draft = {amount:7500, recipient:"Maya Chen", condition:"Files approved"};
const id = "AL-" + "A".repeat(32);
const create = parseWorkspaceOperation({type:"create", id, draft});
const error = (status: number) => (value: unknown) => value instanceof WorkspaceError && value.status === status;

test("workspace edits enforce server-side caps, pause, and independent release permission", () => {
  assert.throws(() => applyWorkspaceOperation(initial, {type:"limit", amount:10}), error(409));
  assert.throws(() => applyWorkspaceOperation({...initial, limit:initial.limit - 200000}, create), error(409));
  assert.throws(() => applyWorkspaceOperation({...initial, paused:true}, create), error(409));
  const created = applyWorkspaceOperation(initial, create);
  const release = parseWorkspaceOperation({type:"escrow", id, action:"release", amount:0});
  assert.throws(() => applyWorkspaceOperation({...created, allowRelease:false}, release), error(409));
  assert.throws(() => applyWorkspaceOperation(initial, release), error(404));
  assert.equal(applyWorkspaceOperation(created, release).escrows[0].status, "Completed");
  assert.equal(applyWorkspaceOperation(created, create), created);
});

test("workspace endpoint accepts operations and rejects workspace snapshots and invalid payment terms", () => {
  assert.throws(() => parseWorkspaceOperation(initial), error(400));
  assert.throws(() => parseWorkspaceOperation({type:"preference", key:"escrows", value:true}), error(400));
  for (const invalid of [{...draft, amount:0}, {...draft, recipient:"someone"}, {...draft, condition:"BTC settles yes"}]) {
    assert.throws(() => parseWorkspaceOperation({type:"create", id, draft:invalid}), error(400));
  }
});
