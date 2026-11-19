import {after} from "next/server";
import {recordSubmission} from "../../../../lib/stream-events.server";
import {JudgeError, runJudgeAction} from "../../../../lib/judge-devnet.server";
export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(request: Request,{params}: {params:Promise<{action:string}>}) {
  const {action} = await params;
  if (action!=="fund" && action!=="attest" && action!=="release" && action!=="cancel") {
    return Response.json({error:"Unknown Devnet action."},{status:404});
  }
  const payload = await request.json().catch(()=>null);
  try {
    return Response.json(await runJudgeAction(action,payload,undefined,(signature, at) => {
      after(() => recordSubmission(signature, at).catch(() => console.error("Devnet timeline fallback failed")));
    }),{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof JudgeError) return Response.json({error:error.message},{status:error.status});
    return Response.json({error:"Devnet did not confirm this request. Retry the same action or check the escrow in Explorer."},{status:502});
  }
}
