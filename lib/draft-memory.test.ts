import {describe, expect, test} from "vitest";
import {chooseDraft, confirmDraft, defaultCondition, draftTurn, editDraft, emptyDraft, readyDraft, type DraftMemory} from "./draft-memory";

function turn(prompt: string, memory = emptyDraft) {
  const result = draftTurn(memory, prompt);
  if (!result) throw new Error(`Unrecognized draft turn: ${prompt}`);
  return result;
}

describe("conversational drafts", () => {
  test("keeps Dave and asks the exact amount question before accepting 50", () => {
    const first = turn("Pay Dave");
    expect(first.reply).toBe("How much should I hold for Dave?");
    expect(first.memory.current).toEqual({recipient: "Dave", status: "incomplete"});
    expect(readyDraft(turn("50", first.memory).memory)).toEqual({amount: 5000, recipient: "Dave", condition: defaultCondition});
  });

  test("asks for recipient after amount and defaults to manual release", () => {
    const first = turn("Hold 50");
    expect(first.reply).toBe("Who should receive it?");
    expect(turn("Dave", first.memory).memory.current).toMatchObject({status: "ready", recipient: "Dave", condition: defaultCondition});
  });

  test("merges explicit conditions and conversational corrections", () => {
    const initial = turn("Hold 100 USDC for Dave until the files arrive").memory;
    const correction = turn("actually 75", initial);
    expect(correction.reply).toBe("I changed the amount to 75.00 USDC.");
    expect(correction.memory.current.condition).toBe("the files arrive");
    const recipient = turn("change it to Maya", correction.memory);
    expect(recipient.reply).toBe("I changed the recipient to Maya.");
    const removed = turn("no condition", recipient.memory);
    expect(removed.memory.current.condition).toBe(defaultCondition);
    expect(turn("Undo", removed.memory).memory.current).toEqual(recipient.memory.current);
  });

  test("offers both readings without overwriting a prior draft or enabling confirmation", () => {
    const original = turn("Hold 100 USDC for Jo").memory;
    const {memory, reply} = turn("50 to Dave and Maya", original);
    expect(reply).toContain("Which recipient");
    expect(memory.current).toEqual(original.current);
    expect(memory.choices?.map(choice => [choice.amount, choice.recipient])).toEqual([[5000, "Dave"], [5000, "Maya"]]);
    expect(readyDraft(memory)).toBeNull();
    expect(chooseDraft(memory, 1).current).toMatchObject({recipient: "Maya", amount: 5000});
    expect(turn("Dave", memory).memory.current).toMatchObject({recipient: "Dave", amount: 5000});
  });

  test("retains only the five most recent versions", () => {
    let memory: DraftMemory = turn("Pay Dave").memory;
    for (const amount of [10,20,30,40,50,60,70]) memory = turn(`make that ${amount}`, memory).memory;
    expect(memory.history).toHaveLength(5);
    for (let i = 0; i < 5; i++) memory = turn("Undo", memory).memory;
    expect(memory.current.amount).toBe(2000);
    expect(turn("Undo", memory).memory).toEqual(memory);
  });

  test.each([
    ["Hold 100 USDC for Dave", "make that 75"],
    ["Hold one hundred USDC for Dave", "make that seventy-five"],
  ])("completes the demo from %s", (instruction, correction) => {
    const start = turn(instruction).memory;
    const revised = turn(correction, start).memory;
    expect(readyDraft(revised)).toEqual({amount: 7500, recipient: "Dave", condition: defaultCondition});
    const confirmed = confirmDraft(revised);
    expect(confirmed.current.status).toBe("confirmed");
    expect(readyDraft(confirmed)).toBeNull();
    expect(turn("Pay Maya", confirmed).memory.current).toEqual({recipient: "Maya", status: "incomplete"});
  });

  test("editing creates an undoable version", () => {
    const start = turn("Hold 100 USDC for Dave").memory;
    const edited = editDraft(start, {recipient: "Maya", amount: 7500});
    expect(edited.current).toMatchObject({recipient: "Maya", amount: 7500});
    expect(turn("undo", edited).memory.current).toEqual(start.current);
  });
});
