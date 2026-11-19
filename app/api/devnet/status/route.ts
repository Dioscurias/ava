import {getJudgeStatus, JudgeError} from "../../../../lib/judge-devnet.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getJudgeStatus(),{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    return Response.json({cluster:"devnet",rpc:{healthy:false,slot:null},error:error instanceof JudgeError ? error.message : "Devnet configuration is unavailable."},{status:503});
  }
}
