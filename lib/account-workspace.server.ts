import {createHash} from "node:crypto";
import {initial, type State} from "./payments";
import {redis, redisEnabled} from "./stream-events.server";
import {applyWorkspaceOperation, WorkspaceError, type WorkspaceOperation} from "./workspace-operations";

const workspaceKey = (id: string) => "ava:workspace:google:v1:" + createHash("sha256").update(id).digest("hex");
const compareAndSet = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
`;

async function read(key: string) {
  if (!redisEnabled()) throw new WorkspaceError("Account storage is unavailable. Try again shortly.",503);
  const existing = await redis<string | null>("GET", key);
  if (existing !== null) return existing;
  const seed = JSON.stringify({...initial, escrows:initial.escrows.map(escrow => ({
    ...escrow, id:"AL-" + createHash("sha256").update(`${key}:${escrow.id}`).digest("hex").slice(0,32).toUpperCase(),
  }))});
  if (await redis<string | null>("SET", key, seed, "NX")) return seed;
  const created = await redis<string | null>("GET", key);
  if (created === null) throw new WorkspaceError("Account storage is unavailable. Try again shortly.",503);
  return created;
}

export async function loadAccountWorkspace(id: string): Promise<State> {
  return JSON.parse(await read(workspaceKey(id)));
}

export async function updateAccountWorkspace(id: string, operation: WorkspaceOperation): Promise<State> {
  const key = workspaceKey(id);
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await read(key);
    const previous: State = JSON.parse(snapshot);
    const next = applyWorkspaceOperation(previous, operation);
    if (next === previous || await redis<number>("EVAL", compareAndSet, 1, key, snapshot, JSON.stringify(next)) === 1) return next;
  }
  throw new WorkspaceError("The workspace changed in another tab. Try again.",409);
}
