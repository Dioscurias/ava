import type {Draft} from "./payments";

export function readPlan(value: unknown): {reply: string; patch?: Partial<Draft>} | null {
  if (!value || typeof value !== "object") return null;
  const {intent, reply, amountCents, recipient, condition} = value as Record<string, unknown>;
  if ((intent !== "draft" && intent !== "reply") || typeof reply !== "string" || !reply.trim() || reply.length > 600) return null;
  if (intent === "reply") return {reply: reply.trim()};
  const patch: Partial<Draft> = {};
  if (amountCents !== null) {
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
    patch.amount = amountCents;
  }
  if (recipient !== null) {
    if (typeof recipient !== "string" || !recipient.trim() || recipient.length > 100) return null;
    patch.recipient = recipient.trim();
  }
  if (condition !== null) {
    if (typeof condition !== "string" || !condition.trim() || condition.length > 500) return null;
    patch.condition = condition.trim();
  }
  return Object.keys(patch).length ? {reply: reply.trim(), patch} : null;
}
