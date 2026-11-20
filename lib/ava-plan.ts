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
