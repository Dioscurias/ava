import {draftTurn, emptyDraft} from "../lib/draft-memory";
import assert from "node:assert/strict";
import {test} from "node:test";
import {readSpeechTurn} from "../lib/speech-turn";
import {classifyWorkspaceQuestion} from "../lib/ava-plan";

const segment = (transcript:string, isFinal:boolean) => Object.assign([{transcript}],{isFinal});

test("speech retains later clauses and waits for interim segments", () => {
  const start = segment("Hold seventy-five U. S. D. C. for Maya",true);
  const continuation = segment("until the files arrive",false);
  assert.deepEqual(readSpeechTurn([start,continuation]),{
    preview:"Hold seventy-five USDC for Maya until the files arrive", complete:"",
  });
  assert.equal(readSpeechTurn([start,segment("until the files arrive",true)]).complete,"Hold seventy-five USDC for Maya until the files arrive");
});

test("workspace shortcuts do not swallow product questions or conditional payment text", () => {
  assert.equal(classifyWorkspaceQuestion("What payments are pending?"),"activity");
  assert.equal(classifyWorkspaceQuestion("What can you spend?"),"limits");
  assert.equal(classifyWorkspaceQuestion("How do I receive USDC"),"receive");
  assert.equal(classifyWorkspaceQuestion("What happens when I receive the files"),null);
  assert.equal(classifyWorkspaceQuestion("Explain why a spending limit might not work"),null);
  assert.equal(classifyWorkspaceQuestion("Pay Maya when I receive the files"),null);
});

test("a dictated question leaves an open draft unchanged", () => {
  const draft = draftTurn(emptyDraft,"Hold 75 USDC for Maya")!.memory;
  assert.equal(draftTurn(draft,"When will Ava release my funds"),null);
  assert.equal(draftTurn(draft,"Until I approve the design files")?.memory.current.condition,"Payer approves the design files");
});
