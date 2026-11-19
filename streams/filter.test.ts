import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import sample from "./sample.json";

const fixture = sample.data[0][0];
const template = readFileSync(new URL("./filter.js", import.meta.url), "utf8");
const code = template.replace("__ESCROW_PROGRAM_ID__", fixture.programInvocations[0].programId);
const run = (payload: unknown) => runInNewContext(code + "\nmain(payload)", {payload});

test("matches the documented Programs + Logs batch", () => {
  const {signature, slot, blockTime} = fixture;
  expect(run(sample)).toEqual([{signature, slot, blockTime}]);
});

test("ignores other programs, failed transactions, and malformed batches", () => {
  expect(run({data: [[{...fixture, programInvocations: [{programId: "other"}]}]]})).toBeNull();
  expect(run({data: [[{...fixture, success: false}]]})).toBeNull();
  expect(run({data: [[null]]})).toBeNull();
  expect(run(null)).toBeNull();
});
