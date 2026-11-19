export const demoInstruction = "Hold 250 USDC for Maya Chen until she delivers the final files.";

export type Draft = {amount: number; recipient: string; condition: string};
export type Status = "Holding" | "Conditions pending" | "Ready to release" | "Completed" | "Cancelled" | "Paused";
export type Escrow = Draft & {id: string; status: Status; events: {label: string; at: string}[]};
export type State = {escrows: Escrow[]; limit: number; paused: boolean; voice: boolean; allowHold: boolean; allowRelease: boolean};
export type Action = "release" | "cancel" | "add" | "pause" | "resume" | "verify";

const seed = (label: string) => [{label, at: "2026-11-18T15:00:00.000Z"}];
export const initial: State = {
  limit: 250000, paused: false, voice: true, allowHold: true, allowRelease: true,
  escrows: [
    {id:"AL-1042", amount:45000, recipient:"Northline Studio", condition:"Final brand assets approved", status:"Conditions pending", events:seed("450 USDC placed in escrow")},
    {id:"AL-1041", amount:12500, recipient:"Maya Chen", condition:"Signed invoice received", status:"Ready to release", events:seed("Signed invoice confirmed")},
    {id:"AL-1040", amount:8000, recipient:"Orbit Research", condition:"Research brief delivered", status:"Completed", events:seed("80 USDC released after delivery was confirmed")},
  ]
};

export const active = (e: Escrow) => e.status !== "Completed" && e.status !== "Cancelled";
export const committed = (state: State) => state.escrows.reduce((total, e) => total + (e.status !== "Cancelled" ? e.amount : 0), 0);
export const money = (amount: number) => new Intl.NumberFormat("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(amount / 100);

export function parsePayment(input: string): Draft | null {
  const match = input.trim().match(/^(?:please\s+)?(?:send|pay|hold|escrow|set aside)\s+\$?(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:USDC|USD)?\s+(?:to|for)\s+(.+?)(?:\s+(?:when|once|after|until|if)\s+(.+))?[.!?]?$/i);
  if (!match) return null;
  const amount = Math.round(Number(match[1].replaceAll(",", "")) * 100);
  const recipient = match[2].trim();
  if (!Number.isSafeInteger(amount) || amount <= 0 || !recipient || recipient.length > 100) return null;
  return {amount, recipient, condition: match[3]?.trim().replace(/[.!?]$/, "") || "You confirm the release"};
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
