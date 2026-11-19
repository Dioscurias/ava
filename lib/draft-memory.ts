import {money, parsePayment, type Draft} from "./payments";

export const defaultCondition = "You confirm the release";
export type DraftField = keyof Draft;
export type DraftVersion = Partial<Draft> & {status: "incomplete" | "ready" | "confirmed"};
export type DraftMemory = {current: DraftVersion; history: DraftVersion[]; choices?: DraftVersion[]};
export const emptyDraft: DraftMemory = {current: {status: "incomplete"}, history: []};
const fields: DraftField[] = ["amount", "recipient", "condition"];

export function changedFields(before: DraftVersion, after: DraftVersion) {
  return fields.filter(field => before[field] !== after[field]);
}

function update(memory: DraftMemory, patch: Partial<Draft>): DraftMemory {
  const base = memory.current.status === "confirmed" ? emptyDraft : memory;
  const current = {...base.current, ...patch};
  current.status = current.amount && current.recipient ? "ready" : "incomplete";
  if (current.status === "ready") current.condition ??= defaultCondition;
  if (!changedFields(base.current, current).length) return {...base, choices: undefined};
  return {current, history: [...base.history, base.current].slice(-5)};
}

export function readyDraft(memory: DraftMemory): Draft | null {
  const {amount, recipient, condition, status} = memory.current;
  return status === "ready" && !memory.choices && amount && recipient && condition
    ? {amount, recipient, condition} : null;
}

export function confirmDraft(memory: DraftMemory): DraftMemory {
  return readyDraft(memory) ? {current: {...memory.current, status: "confirmed"}, history: []} : memory;
}

export function nextDraftQuestion(draft: DraftVersion) {
  if (!draft.amount) return draft.recipient ? `How much should I hold for ${draft.recipient}?` : "How much should I hold?";
  if (!draft.recipient) return "Who should receive it?";
  return "Review the terms before placing funds in escrow.";
}

const units = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const tens = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function spokenNumber(text: string): number | undefined {
  const unit = units.indexOf(text);
  if (unit >= 0) return unit;
  const [ten, tail, extra] = text.split(/[ -]/);
  const digit = tail ? units.indexOf(tail) : 0;
  const index = tens.indexOf(ten);
  if (index >= 0 && !extra && digit >= 0 && digit < 10) return (index + 2) * 10 + digit;
  const hundred = text.match(/^(?:(\w+) )?hundred(?: (?:and )?(.+))?$/);
  if (!hundred) return;
  const multiplier = hundred[1] === "a" || !hundred[1] ? 1 : units.indexOf(hundred[1]);
  const rest = hundred[2] ? spokenNumber(hundred[2]) : 0;
  if (multiplier > 0 && multiplier < 10 && rest !== undefined && rest < 100) return multiplier * 100 + rest;
}

function amountOf(text: string) {
  const value = text.toLowerCase().replace(/\s*(?:usdc|usd|dollars?)$/, "").trim();
  const numeric = /^\$?\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(value)
    ? Number(value.replace(/[$,]/g, "")) : spokenNumber(value);
  const amount = Math.round((numeric ?? NaN) * 100);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

function recipientOf(text: string) {
  const value = text.trim();
  return /^(?!.*(?:\b(?:what|who|how|when|where|why|please|pay|hold)\b))[\p{L}\d][\p{L}\d .’'&,-]{0,99}$/iu.test(value) && /\p{L}/u.test(value)
    ? value : undefined;
}

function ambiguous(patch: Partial<Draft>) {
  return patch.recipient?.split(/\s+(?:and|or)\s+|\s*&\s*/i).map(recipientOf).filter((name): name is string => Boolean(name)) ?? [];
}

export function editDraft(memory: DraftMemory, patch: Partial<Draft>) {
  const recipients = ambiguous(patch);
  if (recipients.length > 1) {
    return {...memory, choices: recipients.map(recipient => update(memory, {...patch, recipient}).current)};
  }
  return update(memory, patch);
}

export function chooseDraft(memory: DraftMemory, index: number) {
  const choice = memory.choices?.[index];
  if (!choice) return memory;
  const {amount, recipient, condition} = choice;
  return update(memory, {amount, recipient, condition});
}

export function draftTurn(memory: DraftMemory, input: string): {memory: DraftMemory; reply: string} | null {
  const text = input.trim().replace(/[.!?]+$/, "");
  if (/^undo$/i.test(text)) {
    if (memory.choices) return {memory: {...memory, choices: undefined}, reply: "I discarded that proposed change."};
    const previous = memory.history.at(-1);
    if (!previous) return {memory, reply: "There’s no draft change to undo."};
    const next = {current: previous, history: memory.history.slice(0, -1)};
    return {memory: next, reply: "I restored the previous draft."};
  }
  if (memory.choices) {
    const index = memory.choices.findIndex(choice => choice.recipient?.toLowerCase() === text.toLowerCase());
    if (index >= 0) {
      const next = chooseDraft(memory, index);
      return {memory: next, reply: next.current.status === "ready"
        ? `I set the recipient to ${next.current.recipient}.` : nextDraftQuestion(next.current)};
    }
  }
  const live = memory.current.status !== "confirmed" && fields.some(field => memory.current[field] !== undefined);
  const amountCorrection = text.match(/^(?:make that|actually|change (?:the )?amount to|amount is)\s+(.+)$/i);
  const recipientCorrection = text.match(/^(?:change (?:it|the recipient) to|(?:the )?recipient is)\s+(.+)$/i);
  const condition = text.match(/^(?:(?:change (?:the )?condition to|condition is|until|when|after|if)\s+)(.+)$/i);
  const noCondition = /^no (?:release )?condition$/i.test(text);
  const amount = amountOf(amountCorrection?.[1] ?? text);
  let patch: Partial<Draft> | undefined;
  if (live && (amountCorrection || amount !== undefined)) {
    if (amount === undefined) return {memory, reply: "Enter a positive USDC amount with up to two decimal places."};
    patch = {amount};
  } else if (live && (recipientCorrection || (memory.current.amount && !memory.current.recipient && !/^(?:pay|hold|send)\b/i.test(text) && !input.includes("?") && !condition && !noCondition))) {
    const recipient = recipientOf(recipientCorrection?.[1] ?? text);
    if (recipient) patch = {recipient};
  }
  if (!patch && live && (condition || noCondition)) patch = {condition: noCondition ? defaultCondition : condition![1]};
  if (!patch) {
    const short = text.match(/^(\$?[\d,.]+(?:\s+USDC)?)\s+(to|for)\s+(.+)$/i);
    const spoken = text.match(/^((?:hold|send|pay|escrow|set aside)\s+)([a-z -]+?)\s+(?:(?:usdc|usd|dollars?)\s+)?((?:to|for)\s+.+)$/i);
    const spokenAmount = spoken && amountOf(spoken[2]);
    const parsed = parsePayment(text) ?? (short ? parsePayment(`Hold ${text}`) : null)
      ?? (spoken && spokenAmount ? parsePayment(`${spoken[1]}${spokenAmount / 100} ${spoken[3]}`) : null);
    const noAmount = text.match(/^(?:pay|send(?: to)?|hold for|escrow for)\s+(.+?)(?:\s+(?:until|when|after|if)\s+(.+))?$/i);
    const noRecipient = text.match(/^(?:pay|send|hold|escrow|set aside)\s+(.+)$/i);
    if (parsed) {
      const {condition: parsedCondition, ...payment} = parsed;
      patch = parsedCondition === defaultCondition && live ? payment : parsed;
    } else if (noRecipient && amountOf(noRecipient[1]) !== undefined) {
      patch = {amount: amountOf(noRecipient[1])};
    } else if (noAmount && recipientOf(noAmount[1]) && !/\b\d/i.test(noAmount[1])) {
      patch = {recipient: noAmount[1], ...(noAmount[2] ? {condition: noAmount[2]} : {})};
    } else if (amount !== undefined) {
      patch = {amount};
    }
  }
  if (!patch) return null;
  if (memory.choices && !patch.recipient) return {memory, reply: "Choose a recipient before changing the draft."};
  const next = editDraft(memory, patch);
  if (next.choices) return {memory: next, reply: "A draft can have one recipient. Which recipient should I use?"};
  if (next.current.status === "incomplete") return {memory: next, reply: nextDraftQuestion(next.current)};
  const changed = changedFields(memory.current, next.current);
  if (live && changed.length === 1) {
    const {amount, recipient, condition} = next.current;
    const replies = {amount: `I changed the amount to ${money(amount!)} USDC.`, recipient: `I changed the recipient to ${recipient}.`,
      condition: condition === defaultCondition ? "I removed the condition. You’ll confirm release." : `I changed the release condition to: ${condition}.`};
    return {memory: next, reply: replies[changed[0]]};
  }
  return {memory: next, reply: nextDraftQuestion(next.current)};
}
