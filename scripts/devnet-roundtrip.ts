import {randomBytes} from "node:crypto";
import {getJudgeStatus, runJudgeAction} from "../lib/judge-devnet.server";

async function roundtrip() {
  const status = await getJudgeStatus();
  console.log(JSON.stringify(status,null,2));
  if (!status.rpc.healthy || !status.classicSpl || status.decimals!==6 ||
      !status.programExecutable || !status.judge.ready) {
    throw Error("Round trip blocked. Check program deployment, RPC, and sponsor balances above.");
  }
  const accessCode = process.env.AVA_JUDGE_ACCESS_CODE;
  for (const path of ["release","cancel"] as const) {
    const requestId = randomBytes(16).toString("hex");
    const funded = await runJudgeAction("fund",{requestId,accessCode,condition:`Ava Devnet round-trip check: ${path}`});
    const session = {requestId,proof:funded.proof,accessCode};
    console.log(`${path} · create and fund (atomic): ${funded.signature} ${funded.explorerUrl}`);
    if (path==="release") {
      const attested = await runJudgeAction("attest",session);
      console.log(`release · attest: ${attested.signature} ${attested.explorerUrl}`);
    }
    const done = await runJudgeAction(path,session);
    console.log(`${path}: ${done.signature} ${done.explorerUrl}`);
  }
}

void roundtrip().catch(error=>{
  console.error(error instanceof Error ? error.message : "Devnet round trip failed.");
  process.exitCode=1;
});
