export const demoInstruction = "Hold 250 USDC for Maya Chen until she delivers the final files.";

export type Draft = {amount: number; recipient: string; condition: string};
export type Status = "Holding" | "Conditions pending" | "Ready to release" | "Completed" | "Cancelled" | "Paused";
export type Escrow = Draft & {id: string; status: Status; events: {label: string; at: string}[]};
export type State = {escrows: Escrow[]; limit: number; paused: boolean; voice: boolean; microphone?: boolean; allowHold: boolean; allowRelease: boolean};
export type Action = "release" | "cancel" | "add" | "pause" | "resume" | "verify";

const seed = (label: string) => [{label, at: "2026-11-18T15:00:00.000Z"}];
export const initial: State = {
  limit: 250000, paused: false, voice: true, microphone: true, allowHold: true, allowRelease: true,
  escrows: [
    {id:"AL-1042", amount:45000, recipient:"Northline Studio", condition:"Final brand assets approved", status:"Conditions pending", events:seed("450 USDC placed in escrow")},
    {id:"AL-1041", amount:12500, recipient:"Maya Chen", condition:"Signed invoice received", status:"Ready to release", events:seed("Signed invoice confirmed")},
    {id:"AL-1040", amount:8000, recipient:"Orbit Research", condition:"Research brief delivered", status:"Completed", events:seed("80 USDC released after delivery was confirmed")},
  ]
};

export const active = (e: Escrow) => e.status !== "Completed" && e.status !== "Cancelled";
export const committed = (state: State) => state.escrows.reduce((total, e) => total + (active(e) ? e.amount : 0), 0);
export const money = (amount: number) => new Intl.NumberFormat("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(amount / 100);

const paymentLead = /^(?:so[,\s]+)?(?:(?:i\s+(?:wanna|want\s+to|would\s+like\s+to)|i['’]d\s+like\s+to|(?:could|can|would)\s+you|please)[,\s]+)?/i;
const paymentAmount = String.raw`\$?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?:\s*(?:USDC|USD|dollars?))?`;
const releaseCondition = String.raw`(?:\s+(?:when|once|after|until|if)\s+(.+))?`;
const amountFirst = new RegExp(String.raw`^(?:send|pay|hold|escrow|set aside|make (?:a )?payment(?: of)?)\s+${paymentAmount}\s+(?:to|for)\s+(.+?)${releaseCondition}$`, "i");
const recipientFirst = new RegExp(String.raw`^(?:(?:send|make) (?:a )?payment(?:\s+(?:to|for))?|pay)\s+(.+?)[,;:]?\s+(?:(?:and\s+)?(?:the\s+)?amount\s*(?:is|:|of)\s*)?${paymentAmount}${releaseCondition}$`, "i");

export function parsePayment(input: string): Draft | null {
  const instruction = input.trim().replace(paymentLead, "")
    .replace(/(?:[,\s]+and\s+that['’]s\s+(?:his|her|their|the)\s+recipient)?(?:[,\s]+(?:so\s+)?please)?[.!?]*$/i, "");
  const direct = instruction.match(amountFirst);
  const reverse = direct ? null : instruction.match(recipientFirst);
  if (!direct && !reverse) return null;
  const [value, payee, condition] = direct ? direct.slice(1) : [reverse![2], reverse![1], reverse![3]];
  const amount = Math.round(Number(value.replaceAll(",", "")) * 100);
  const recipient = payee.trim();
  if (/\$|(?:^|\s)(?:-\d|\d+(?:\.\d+)?\s*(?:USDC|USD|dollars?)\b)/i.test(recipient)) return null;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !recipient || recipient.length > 100) return null;
  return {amount, recipient, condition: condition?.trim().replace(/[.!?]$/, "") || "You confirm the release"};
}

export function guard(state: State, amount: number) {
  if (state.paused) return "The agent is paused. Resume it in Settings to commit a payment.";
  if (!state.allowHold) return "Escrow funding is disabled in Settings.";
  if (!Number.isSafeInteger(amount) || amount <= 0) return "Enter a positive USDC amount with up to two decimal places.";
  if (committed(state) + amount > state.limit) return "This amount would exceed your workspace spending limit.";
  return null;
}

export function addEscrow(state: State, draft: Draft, id: string): State {
  if (guard(state, draft.amount)) return state;
  return {...state, escrows: [{...draft, id, status:"Conditions pending", events:[{label:`${money(draft.amount)} USDC placed in demo escrow`, at:new Date().toISOString()}]}, ...state.escrows]};
}

export function changeEscrow(state: State, id: string, action: Action, amount = 0): State {
  const escrow = state.escrows.find(e => e.id === id);
  if (!escrow || !active(escrow)) return state;
  if (action === "release" && (state.paused || !state.allowRelease || escrow.status === "Paused")) return state;
  if (action === "add" && (escrow.status === "Paused" || guard(state, amount))) return state;
  if (action === "verify" && (state.paused || !["Holding", "Conditions pending"].includes(escrow.status))) return state;
  if (action === "resume" && (state.paused || escrow.status !== "Paused")) return state;
  if (action === "pause" && escrow.status === "Paused") return state;
  const updates: Record<Action, [Status, string]> = {
    release: ["Completed", escrow.status === "Ready to release" ? "Released after condition confirmation" : "Early release approved by you"],
    cancel: ["Cancelled", "Escrow cancelled and demo funds released back"],
    add: [escrow.status, `${money(amount)} USDC added to demo escrow`],
    pause: ["Paused", "Escrow paused by you"],
    resume: ["Conditions pending", "Escrow resumed. Condition requires review."],
    verify: ["Ready to release", "Release condition marked as met by you"],
  };
  const [status, label] = updates[action];
  const updated = {...escrow, status, amount: escrow.amount + (action === "add" ? amount : 0), events:[...escrow.events, {label, at:new Date().toISOString()}]};
  return {...state, escrows:state.escrows.map(e => e.id === id ? updated : e)};
}

export function conditionOutcome(escrow: Escrow): "Met" | "Pending" | "Unmet" {
  if (escrow.status === "Ready to release") return "Met";
  if (escrow.status === "Completed") {
    return escrow.events.at(-1)?.label === "Early release approved by you" ? "Unmet" : "Met";
  }

  // Older browser records preserve condition decisions in their timeline.
  for (let index = escrow.events.length - 1; index >= 0; index--) {
    const {label} = escrow.events[index];
    if (label === "Escrow resumed. Condition requires review.") break;
    if (label === "Release condition marked as met by you" || label === "Signed invoice confirmed") return "Met";
  }
  return escrow.status === "Cancelled" ? "Unmet" : "Pending";
}

export function displayCondition(condition: string) {
  const value = condition.trim();
  return value.replace(/^I (approve|accept|confirm|receive|verify|sign|review|acknowledge|deliver|submit|check|finish|complete|can|have|am|do)\b/i,
    (_, verb: string) => {
      const action = verb.toLowerCase();
      const irregular: Record<string, string> = {can: "can", have: "has", am: "is", do: "does", finish: "finishes"};
      return `Payer ${irregular[action] ?? `${action}s`}`;
    });
}
