import {readyDraft} from "./draft-memory";
import {parseMarketCondition} from "./gemini-condition";
import {addEscrow, changeEscrow, committed, guard, money, type Action, type Draft, type State} from "./payments";

export const workspacePreferences = ["allowHold", "allowRelease", "microphone", "voice", "paused"] as const;
const escrowActions: readonly Action[] = ["release", "cancel", "add", "pause", "resume", "verify"];

export type WorkspaceOperation =
  | {type:"create"; id:string; draft:Draft}
  | {type:"escrow"; id:string; action:Action; amount:number}
  | {type:"limit"; amount:number}
  | {type:"preference"; key:typeof workspacePreferences[number]; value:boolean};

export class WorkspaceError extends Error {
  constructor(message: string, readonly status: number = 400) { super(message); }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseWorkspaceOperation(value: unknown): WorkspaceOperation {
  const input = record(value);
  const amount = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const id = typeof input.id === "string" && /^AL-[A-F0-9]{4,32}$/.test(input.id) ? input.id : null;
  if (input.type === "create" && id && id.length === 35) {
    const draft = record(input.draft);
    if (typeof draft.amount === "number" && typeof draft.recipient === "string" && typeof draft.condition === "string") {
      const recipient = draft.recipient.trim();
      const condition = draft.condition.trim();
      if (recipient.length <= 100 && condition.length <= 500 && !parseMarketCondition(condition)) {
        const terms = readyDraft({current:{amount:draft.amount, recipient, condition, status:"ready"}, history:[]});
        if (terms) return {type:"create", id, draft:terms};
      }
    }
  }
  if (input.type === "escrow" && id && typeof input.amount === "number" && amount(input.amount) && escrowActions.includes(input.action as Action)) {
    return {type:"escrow", id, action:input.action as Action, amount:input.amount};
  }
  if (input.type === "limit" && typeof input.amount === "number" && amount(input.amount)) return {type:"limit", amount:input.amount};
  if (input.type === "preference" && workspacePreferences.includes(input.key as typeof workspacePreferences[number]) && typeof input.value === "boolean") {
    return {type:"preference", key:input.key as typeof workspacePreferences[number], value:input.value};
  }
  throw new WorkspaceError("Invalid workspace change.");
}

export function applyWorkspaceOperation(state: State, operation: WorkspaceOperation): State {
  switch (operation.type) {
    case "create": {
      const existing = state.escrows.find(escrow => escrow.id === operation.id);
      if (existing) {
        const {amount, recipient, condition} = operation.draft;
        if (existing.amount === amount && existing.recipient === recipient && existing.condition === condition) return state;
        throw new WorkspaceError("That escrow ID is already in use.",409);
      }
      const issue = guard(state, operation.draft.amount);
      if (issue) throw new WorkspaceError(issue,409);
      return addEscrow(state, operation.draft, operation.id);
    }
    case "escrow": {
      if (!state.escrows.some(escrow => escrow.id === operation.id)) throw new WorkspaceError("Escrow unavailable.",404);
      const next = changeEscrow(state, operation.id, operation.action, operation.amount);
      if (next === state) throw new WorkspaceError("This escrow action is unavailable under your current settings or balance.",409);
      return next;
    }
    case "limit": {
      const minimum = committed(state);
      if (operation.amount < minimum) throw new WorkspaceError(`Enter a limit of at least ${money(minimum)} USDC to cover active escrows.`,409);
      return {...state, limit:operation.amount};
    }
    case "preference":
      if (state.paused && (operation.key === "allowHold" || operation.key === "allowRelease")) {
        throw new WorkspaceError("Resume the workspace before changing funding or release permissions.",409);
      }
      return {...state, [operation.key]:operation.value};
  }
}
