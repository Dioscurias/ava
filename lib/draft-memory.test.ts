import {describe, expect, test} from "vitest";
import {chooseDraft, applyPlannedDraft, confirmDraft, defaultCondition, draftTurn, editDraft, emptyDraft, readyDraft, resolveKnownRecipient, type DraftMemory} from "./draft-memory";

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
    expect(first.reply).toBe("Who should I pay?");
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

  test.each(["make it 60 instead", "make it sixty instead"])("corrects the hackathon draft with %s", correction => {
    const start = turn("Hold 75 USDC for Maya until I approve the design files").memory;
    const revised = turn(correction, start).memory;
    const draft = {amount: 6000, recipient: "Maya", condition: "Payer approves the design files"};
    expect(readyDraft(revised)).toEqual(draft);

    const edited = editDraft(revised, {amount: 6500});
    expect(readyDraft(edited)?.amount).toBe(6500);
    const restored = turn("Undo", edited).memory;
    expect(readyDraft(restored)).toEqual(draft);
    expect(confirmDraft(restored).current).toEqual({...draft, status: "confirmed"});
  });

  test("editing creates an undoable version", () => {
    const start = turn("Hold 100 USDC for Dave").memory;
    const edited = editDraft(start, {recipient: "Maya", amount: 7500});
    expect(edited.current).toMatchObject({recipient: "Maya", amount: 7500});
    expect(turn("undo", edited).memory.current).toEqual(start.current);
  });
});

test.each(["pay him", "pay her", "pay them", "pay someone", "pay", "please pay him", "pay them, please", "Send 75 USDC to", "change it to unknown", "Send 75 USDC to them"])(
  "requires a named recipient after %s", prompt => {
    const original = turn("Hold 75 USDC for Maya").memory;
    const reply = turn(prompt, original);
    expect(reply.reply).toBe("Who should I pay?");
    expect(reply.memory.current.recipient).toBeUndefined();
    expect(readyDraft(reply.memory)).toBeNull();
    expect(readyDraft(turn("Bob", reply.memory).memory)?.recipient).toBe("Bob");
  },
);

test("a garbled instruction requires the amount to be restated", () => {
  const original = turn("Hold 75 USDC for Maya").memory;
  const {memory, reply} = turn("nd 10000 USDC to Bob", original);
  expect(reply).toBe("How much should I hold for Bob?");
  expect(memory.current.amount).toBeUndefined();
  expect(readyDraft(memory)).toBeNull();
  expect(readyDraft(turn("10000", memory).memory)?.amount).toBe(1_000_000);
});

test("planned amounts must match a literal or spoken amount in the request", () => {
  const original = turn("Hold 75 USDC for Maya").memory;
  expect(readyDraft(applyPlannedDraft(original, "Earmark 10000 USDC for Bob.", {amount: 10_000, recipient: "Bob"}).memory)).toBeNull();
  expect(readyDraft(applyPlannedDraft(original, "Earmark seventy-five USDC for Maya.", {amount: 7500}).memory)?.amount).toBe(7500);
  expect(readyDraft(applyPlannedDraft(original, "Use a total of 10000.", {amount: 1_000_000}).memory)?.amount).toBe(1_000_000);
  expect(readyDraft(applyPlannedDraft(original, "Pay them", {recipient: "them"}).memory)).toBeNull();
});


test("a short known name needs confirmation before the draft is ready", () => {
  const draft = turn("Hold 75 USDC for Maya until I approve the design files").memory;
  const suggestion = resolveKnownRecipient(emptyDraft, draft, ["Maya Chen", "maya chen", "Bob"]);
  expect(suggestion?.reply).toBe("Do you mean Maya Chen?");
  expect(readyDraft(suggestion!.memory)).toBeNull();
  expect(readyDraft(turn("yes", suggestion!.memory).memory)).toEqual({
    amount: 7500, recipient: "Maya Chen", condition: "Payer approves the design files",
  });
  expect(resolveKnownRecipient(emptyDraft, draft, ["Maya Chen", "Maya Patel"])?.memory.choices).toHaveLength(2);
});

test("market conditions start with a capital letter", () => {
  expect(turn("Pay Maya 20 USDC until the next BTC 5-minute round settles up").memory.current.condition)
    .toBe("The next BTC 5-minute round settles up");
});

test("partial recipient prefixes need approval and cannot be confirmed after undo", () => {
  const draft = turn("Hold 75 USDC for mAYa Ch").memory;
  const suggestion = resolveKnownRecipient(emptyDraft, draft, ["Maya Chen"])!;
  expect(suggestion.reply).toBe("Do you mean Maya Chen?");
  expect(readyDraft(turn("yes", suggestion.memory).memory)?.recipient).toBe("Maya Chen");
  expect(readyDraft(turn("undo", suggestion.memory).memory)).toBeNull();
  expect(readyDraft(turn("no", suggestion.memory).memory)).toBeNull();
  expect(turn("no", suggestion.memory).reply).toBe("Who should I pay?");
});
