import {type NextRequest} from "next/server";
import {workspaceAccount} from "../../../auth";
import {loadAccountWorkspace, updateAccountWorkspace} from "../../../lib/account-workspace.server";
import {parseWorkspaceOperation, WorkspaceError} from "../../../lib/workspace-operations";

const reply = (value: unknown, status = 200) => Response.json(value, {status, headers:{"Cache-Control":"private, no-store"}});

async function accountFor(request: NextRequest) {
  const account = await workspaceAccount();
  if (!account) throw new WorkspaceError("Sign in to access a saved workspace.",401);
  const expected = request.headers.get("x-ava-account");
  if (expected !== null && expected !== account.id) throw new WorkspaceError("Your account changed. Refresh to continue.",409);
  return account;
}

function failure(error: unknown) {
  return error instanceof WorkspaceError ? reply({error:error.message},error.status)
    : reply({error:"Account storage is unavailable. Try again shortly."},503);
}

export async function GET(request: NextRequest) {
  try {
    const account = await accountFor(request);
    return reply({state:await loadAccountWorkspace(account.id)});
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const account = await accountFor(request);
    const origin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : request.nextUrl.origin;
    if (request.headers.get("origin") !== origin ||
        request.headers.get("x-ava-account") !== account.id ||
        request.headers.get("content-type")?.split(";")[0] !== "application/json") {
      throw new WorkspaceError("Workspace changes must come from your signed-in Ava session.",403);
    }
    const operation = parseWorkspaceOperation(await request.json().catch(() => null));
    return reply({state:await updateAccountWorkspace(account.id, operation)});
  } catch (error) { return failure(error); }
}
