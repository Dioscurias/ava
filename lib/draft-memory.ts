import {scheduledCondition} from "./release-schedule";
import {isDraftQuestion} from "./ava-plan";
import {parseMarketCondition} from "./gemini-condition";
import {displayCondition, money, parsePayment, type Draft} from "./payments";

export const defaultCondition = "You confirm the release";
export type DraftField = keyof Draft;
export type DraftVersion = Partial<Draft> & {status: "incomplete" | "ready" | "confirmed"};
export type DraftMemory = {current: DraftVersion; history: DraftVersion[]; choices?: DraftVersion[]};
export const emptyDraft: DraftMemory = {current: {status: "incomplete"}, history: []};
const unresolvedRecipient = /^(?:(?:pay|send)(?: to)? )?(?:him|her|them|they|he|she|it|me|you|us|someone|somebody|anyone|anybody|everyone|everybody|nobody|unknown|unspecified|tbd|the recipient|that person|this person|that guy|that one|n\/?a)$/i;
const validAmount = (amount?: number): amount is number => Number.isSafeInteger(amount) && (amount ?? 0) > 0;
const fields: DraftField[] = ["amount", "recipient", "condition"];

export function changedFields(before: DraftVersion, after: DraftVersion) {
  return fields.filter(field => before[field] !== after[field]);
}

function update(memory: DraftMemory, patch: Partial<Draft>): DraftMemory {
  const base = memory.current.status === "confirmed" ? emptyDraft : memory;
  const current = {...base.current, ...patch};
  current.status = validAmount(current.amount) && current.recipient ? "ready" : "incomplete";
  if (current.status === "ready") current.condition ??= defaultCondition;
  if (!changedFields(base.current, current).length) return {...base, choices: undefined};
  return {current, history: [...base.history, base.current].slice(-5)};
}

export function readyDraft(memory: DraftMemory): Draft | null {
  const {amount, recipient, condition, status} = memory.current;
  return status === "ready" && !memory.choices && validAmount(amount) && recipient && !unresolvedRecipient.test(recipient.trim()) && condition
    ? {amount, recipient, condition} : null;
}

export function confirmDraft(memory: DraftMemory): DraftMemory {
  return readyDraft(memory) ? {current: {...memory.current, status: "confirmed"}, history: []} : memory;
}

export function nextDraftQuestion(draft: DraftVersion) {
  if (!draft.amount) return draft.recipient ? `How much should I hold for ${draft.recipient}?` : "How much should I hold?";
  if (!draft.recipient) return "Who should I pay?";
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
  return !unresolvedRecipient.test(value) && /^(?!.*(?:\b(?:what|who|how|when|where|why|please|pay|hold)\b))[\p{L}\d][\p{L}\d .’'&,-]{0,99}$/iu.test(value) && /\p{L}/u.test(value)
    ? value : undefined;
}

function ambiguous(patch: Partial<Draft>) {
  return patch.recipient?.split(/\s+(?:and|or)\s+|\s*&\s*/i).map(recipientOf).filter((name): name is string => Boolean(name)) ?? [];
}

function neutralCondition(condition: string) {
  const value = condition.trim();
  if (parseMarketCondition(value)) return value.charAt(0).toUpperCase() + value.slice(1);
  return displayCondition(value);
}

export function resolveKnownRecipient(before: DraftMemory, next: DraftMemory, names: string[]) {
  const recipient = next.current.recipient?.trim().toLowerCase();
  if (!recipient || next.choices || recipient === before.current.recipient?.trim().toLowerCase()) return null;
  const known = new Map<string, string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!known.has(key)) known.set(key, name.trim());
  }
  const exact = known.get(recipient);
  if (exact) {
    if (exact === next.current.recipient) return null;
    const memory = {...next, current: {...next.current, recipient: exact}};
    return {memory, reply: describeDraftChange(before, memory)};
  }
  const matches = [...known].filter(([name]) => name.startsWith(recipient)).map(([, name]) => name);
  if (!matches.length) return null;
  return {
    memory: {...before, choices: matches.map(name => ({...next.current, recipient: name}))},
    reply: matches.length === 1 ? `Do you mean ${matches[0]}?` : "Which recipient should I use?",
  };
}

export function editDraft(memory: DraftMemory, patch: Partial<Draft>) {
  if (patch.condition) patch = {...patch, condition: neutralCondition(patch.condition)};
  if (patch.recipient?.split(/\s+(?:and|or)\s+|\s*&\s*/i).some(part => unresolvedRecipient.test(part.trim()))) {
    return update(memory, {...patch, recipient: undefined});
  }
  const recipients = ambiguous(patch);
  if (recipients.length > 1) {
    return {...memory, choices: recipients.map(recipient => update(memory, {...patch, recipient}).current)};
  }
  if ("recipient" in patch) {
    patch = {...patch, recipient: patch.recipient && !unresolvedRecipient.test(patch.recipient.trim()) ? patch.recipient.trim() || undefined : undefined};
  }
  if ("amount" in patch && !validAmount(patch.amount)) patch = {...patch, amount: undefined};
  return update(memory, patch);
}

export function chooseDraft(memory: DraftMemory, index: number) {
  const choice = memory.choices?.[index];
  if (!choice) return memory;
  const {amount, recipient, condition} = choice;
  return update(memory, {amount, recipient, condition});
}

export function describeDraftChange(before: DraftMemory, next: DraftMemory) {
  if (next.choices) return "A draft can have one recipient. Which recipient should I use?";
  if (next.current.status === "incomplete") return nextDraftQuestion(next.current);

  const {amount, recipient, condition} = next.current;
  const changed = changedFields(before.current, next.current);
  if (before.current.status !== "confirmed" && fields.some(field => before.current[field] !== undefined) && changed.length === 1) {
    if (changed[0] === "amount") return `I changed the amount to ${money(amount!)} USDC.`;
    if (changed[0] === "recipient") return `I changed the recipient to ${recipient}.`;
    return condition === defaultCondition ? "I removed the condition. You’ll confirm release." : `I changed the release condition to: ${condition}.`;
  }
  return `I drafted ${money(amount!)} USDC for ${recipient}. Check the release condition before confirming.`;
}

export function applyPlannedDraft(memory: DraftMemory, prompt: string, patch: Partial<Draft>) {
  if (patch.amount !== undefined) {
    const numberWords = [...units, ...tens, "hundred", "and", "a"].join("|");
    const spelled = new RegExp(`\\b(?:${numberWords})(?:[ -]+(?:${numberWords}))*\\b`, "gi");
    const candidates = [
      ...prompt.matchAll(/(?<![\w,.+-])\$?\d+(?:,\d{3})*(?:\.\d+)?(?![\w]|[,.]\d)/g),
      ...prompt.matchAll(spelled),
    ];
    if (!candidates.some(([candidate]) => amountOf(candidate) === patch.amount)) {
      const next = editDraft(memory, {...patch, amount: undefined});
      return {memory: next, reply: "How much should I hold?"};
    }
  }
  const next = editDraft(memory, patch);
  return {memory: next, reply: ("recipient" in patch && !next.current.recipient && !next.choices)
    ? "Who should I pay?" : describeDraftChange(memory, next)};
}

export function draftTurn(memory: DraftMemory, input: string): {memory: DraftMemory; reply: string} | null {
  const text = input.trim().replace(/[.!?]+$/, "").replace(/^please[,\s]+|[,\s]+please$/gi, "").trim();
  // Dictation may omit question marks, so use phrasing to spot questions before interpreting draft edits.
  if (isDraftQuestion(text)) return null;
  if (/^undo$/i.test(text)) {
    if (memory.choices) return {memory: {...memory, choices: undefined}, reply: "I discarded that proposed change."};
    const previous = memory.history.at(-1);
    if (!previous) return {memory, reply: "There’s no draft change to undo."};
    const next = {current: previous, history: memory.history.slice(0, -1)};
    return {memory: next, reply: "I restored the previous draft."};
  }
  if (memory.choices) {
    if (memory.choices.length === 1 && /^(?:no|nope)$/i.test(text)) {
      const {amount, condition} = memory.choices[0];
      return {memory: editDraft(memory, {amount, condition, recipient: undefined}), reply: "Who should I pay?"};
    }
    const singleMatchAccepted = memory.choices.length === 1 && /^(?:yes|yes,? that(?:'s| is) right|correct)$/i.test(text);
    const index = singleMatchAccepted ? 0 : memory.choices.findIndex(choice => choice.recipient?.toLowerCase() === text.toLowerCase());
    if (index >= 0) {
      const next = chooseDraft(memory, index);
      return {memory: next, reply: next.current.status === "ready"
        ? `I set the recipient to ${next.current.recipient}.` : nextDraftQuestion(next.current)};
    }
  }
  const live = memory.current.status !== "confirmed" && fields.some(field => memory.current[field] !== undefined);
  const amountCorrection = text.match(/^(?:make (?:it|that)|actually|change (?:the )?amount to|amount is)\s+(.+?)(?:\s+instead)?$/i);
  const recipientCorrection = text.match(/^(?:change (?:it|the recipient) to|(?:the )?recipient is)\s+(.+)$/i);
  const condition = text.match(/^(?:(?:change (?:the )?condition to|condition is|until|when|after|if)\s+)(.+)$/i);
  const scheduledFollowUp = text.match(/^(?:release(?: it)?|schedule(?: release)?)\s+(.+)$/i)?.[1];
  const timedCondition = scheduledFollowUp && scheduledCondition(scheduledFollowUp) ? scheduledFollowUp : undefined;
  const noCondition = /^no (?:release )?condition$/i.test(text);
  const amount = amountOf(amountCorrection?.[1] ?? text);
  const unresolved = text.match(/^(?:pay|send|hold|escrow|set aside)(?: to| for)?(?:\s+(.+))?$/i);
  const candidate = recipientCorrection?.[1] ?? unresolved?.[1];
  if ((candidate && unresolvedRecipient.test(candidate)) || (live && unresolved && !candidate)) {
    return {memory: editDraft(memory, {recipient: undefined}), reply: "Who should I pay?"};
  }
  const missingPayee = text.match(/^(?:pay|send|hold|escrow|set aside)\s+(.+?)\s+(?:to|for)$/i);
  const amountWithoutPayee = missingPayee && amountOf(missingPayee[1]);
  if (amountWithoutPayee) {
    return {memory: editDraft(memory, {amount: amountWithoutPayee, recipient: undefined}), reply: "Who should I pay?"};
  }
  let patch: Partial<Draft> | undefined;
  if (live && (amountCorrection || amount !== undefined)) {
    if (amount === undefined) return {memory, reply: "Enter a positive USDC amount with up to two decimal places."};
    patch = {amount};
  } else if (live && (recipientCorrection || (memory.current.amount && !memory.current.recipient && !/^(?:pay|hold|send)\b/i.test(text) && !input.includes("?") && !/\b(?:USDC|USD|dollars?)\b/i.test(text) && !condition && !noCondition))) {
    const recipient = recipientOf(recipientCorrection?.[1] ?? text);
    if (recipient) patch = {recipient};
  }
  if (!patch && live && (condition || timedCondition || noCondition)) patch = {condition: noCondition ? defaultCondition : timedCondition ?? condition![1]};
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
  if (!patch) {
    const fragment = text.match(/^(?:nd|end|ay|old)\s+(?:\$?[\d.,]+|[^\s]+)\s+(?:USDC|USD|dollars?)\s+(?:to|for)\s+(.+)$/i);
    if (!fragment) return null;
    const next = editDraft(memory, {amount: undefined, recipient: recipientOf(fragment[1])});
    return {memory: next, reply: nextDraftQuestion(next.current)};
  }
  if (memory.choices && !patch.recipient) return {memory, reply: "Choose a recipient before changing the draft."};
  const next = editDraft(memory, patch);
  if ("recipient" in patch && !next.current.recipient && !next.choices) {
    return {memory: next, reply: "Who should I pay?"};
  }
  return {memory: next, reply: describeDraftChange(memory, next)};
}
