import type {Draft} from "./payments";

export function readPlan(value: unknown): {reply: string; patch?: Partial<Draft>} | null {
  if (!value || typeof value !== "object") return null;
  const {intent, reply, amountCents, recipient, condition} = value as Record<string, unknown>;
  const message = typeof reply === "string" && reply.length <= 600 ? reply.trim() : "";
  if (intent === "reply") return message ? {reply: message} : null;
  if (intent !== "draft") return null;
  const patch: Partial<Draft> = {};
  if (amountCents != null && amountCents !== 0) {
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
    patch.amount = amountCents;
  }
  if (recipient != null && recipient !== "") {
    if (typeof recipient !== "string" || !recipient.trim() || recipient.length > 100) return null;
    patch.recipient = recipient.trim();
  }
  if (condition != null && condition !== "") {
    if (typeof condition !== "string" || !condition.trim() || condition.length > 500) return null;
    patch.condition = condition.trim();
  }
  return Object.keys(patch).length ? {reply: message || "Review the proposed payment terms.", patch} : null;
}

export function classifyWorkspaceQuestion(input: string): "activity" | "limits" | "receive" | null {
  const text = input.trim().replace(/[.!?]+$/, "").toLowerCase();
  if (/^(?:(?:show|check|list)(?: me)? (?:my |the )?)?(?:payment status|activity|escrow history|(?:active|open|pending) (?:escrows|payments))$/.test(text) ||
      /^(?:what|which) (?:payments|escrows) are (?:pending|open|active)$/.test(text)) return "activity";
  if (/^what can (?:you|i) spend$/.test(text) ||
      /^(?:(?:show|check)(?: me)? |what(?: is|'s) )?(?:my |your |the )?(?:spending|workspace) limits?$/.test(text)) return "limits";
  if (/^(?:how (?:do|can) i receive usdc|(?:get|show)(?: me)? (?:my )?(?:receiving details|wallet address))$/.test(text)) return "receive";
  return null;
}

export function isDraftQuestion(input: string) {
  return /^(?:what|why|how|who|where|when (?:does|do|can|will|should|is|are)|can (?:i|we)|could (?:i|we)|explain|tell me about)\b/i.test(input.trim());
}
