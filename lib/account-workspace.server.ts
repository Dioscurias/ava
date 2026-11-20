import {createHash} from "node:crypto";
import {Firestore} from "@google-cloud/firestore";
import {initial, type State} from "./payments";
import {applyWorkspaceOperation, WorkspaceError, type WorkspaceOperation} from "./workspace-operations";

let firestore: Firestore | undefined;

export function accountStorageEnabled() {
  return Boolean(process.env.AVA_GOOGLE_CLOUD_PROJECT?.trim() &&
    (process.env.AVA_GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || process.env.FIRESTORE_EMULATOR_HOST?.trim()));
}

function workspace(id: string) {
  if (!accountStorageEnabled()) throw new WorkspaceError("Account storage is unavailable. Try again shortly.",503);
  if (!firestore) {
    const raw = process.env.AVA_GOOGLE_SERVICE_ACCOUNT_JSON;
    const credentials = raw ? JSON.parse(raw) : undefined;
    firestore = new Firestore({projectId:process.env.AVA_GOOGLE_CLOUD_PROJECT, credentials});
  }
  const key = createHash("sha256").update(id).digest("hex");
  return firestore.collection("avaWorkspaces").doc(key);
}

function initialWorkspace(key: string): State {
  return {...initial, escrows:initial.escrows.map(escrow => ({
    ...escrow, id:"AL-" + createHash("sha256").update(`${key}:${escrow.id}`).digest("hex").slice(0,32).toUpperCase(),
  }))};
}

export async function loadAccountWorkspace(id: string): Promise<State> {
  const doc = workspace(id);
  const existing = await doc.get();
  if (existing.exists) return JSON.parse(existing.get("snapshot"));
  const initialState = initialWorkspace(doc.id);
  try {
    await doc.create({snapshot:JSON.stringify(initialState)});
    return initialState;
  } catch (error) {
    // Another tab can initialize this account between the read and create.
    if ((error as {code?:number})?.code !== 6) throw error;
    const created = await doc.get();
    return JSON.parse(created.get("snapshot"));
  }
}

export async function updateAccountWorkspace(id: string, operation: WorkspaceOperation): Promise<State> {
  const doc = workspace(id);
  return firestore!.runTransaction(async transaction => {
    const existing = await transaction.get(doc);
    const previous: State = existing.exists ? JSON.parse(existing.get("snapshot")) : initialWorkspace(doc.id);
    const next = applyWorkspaceOperation(previous, operation);
    if (!existing.exists || next !== previous) transaction.set(doc,{snapshot:JSON.stringify(next)});
    return next;
  });
}
