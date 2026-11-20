import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {runJudgeAction} from "../lib/judge-devnet.server";
import {devnetGenesis} from "../lib/devnet";
import {spawn} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAccount,
  getAssociatedTokenAddressSync, MintLayout, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram, Connection, Keypair, SYSVAR_CLOCK_PUBKEY, Transaction,
} from "@solana/web3.js";
import {
  configurePolicy, devnetMint, fetchDevnet, fundEscrow, manageEscrow, manageTimedEscrow, parseLiveInstruction, escrowAddress, storedEscrow,
} from "../lib/devnet";

async function main() {
  const tokenBinary = process.env.AVA_TEST_TOKEN_PROGRAM;
  const associatedBinary = process.env.AVA_TEST_ATA_PROGRAM;
  if (!tokenBinary || !associatedBinary) throw Error("Set AVA_TEST_TOKEN_PROGRAM and AVA_TEST_ATA_PROGRAM to the Devnet SPL program dumps.");
  const payer = Keypair.generate();
  const recipientSigner = Keypair.generate();
  const recipient = recipientSigner.publicKey;
  const program = Keypair.generate().publicKey;
  const ledger = await mkdtemp(join(tmpdir(),"ava-validator-"));
  const mintDump = join(ledger,"mint.json");
  const mintData = Buffer.alloc(MintLayout.span);
  MintLayout.encode({
    mintAuthorityOption:1, mintAuthority:payer.publicKey, supply:0n,
    decimals:6, isInitialized:true, freezeAuthorityOption:0, freezeAuthority:payer.publicKey,
  },mintData);
  await writeFile(mintDump,JSON.stringify({
    pubkey:devnetMint.toBase58(),
    account:{lamports:1_461_600,data:[mintData.toString("base64"),"base64"],owner:TOKEN_PROGRAM_ID.toBase58(),executable:false,rentEpoch:0},
  }));
  const port = process.env.AVA_VALIDATOR_PORT ?? "18999";
  const connection = new Connection(`http://127.0.0.1:${port}`,"confirmed");
  const validator = spawn(process.env.AVA_TEST_VALIDATOR ?? "solana-test-validator",[
    "--ledger",join(ledger,"data"),"--rpc-port",port,"--faucet-port","19900",
    "--bind-address","127.0.0.1","--mint",payer.publicKey.toBase58(),
    "--account",devnetMint.toBase58(),mintDump,
    "--upgradeable-program",TOKEN_PROGRAM_ID.toBase58(),tokenBinary,payer.publicKey.toBase58(),
    "--upgradeable-program",ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),associatedBinary,payer.publicKey.toBase58(),
    "--upgradeable-program",program.toBase58(),resolve("program/target/deploy/ava_escrow.so"),payer.publicKey.toBase58(),"--log",
  ],{stdio:["ignore","ignore","pipe"]});
  let log = "";
  validator.stderr?.on("data", chunk => {log = (log + chunk).slice(-4000);});
  const ready = new Promise<number | null>((resolve, reject) => {
    validator.once("exit",resolve);
    validator.once("error",reject);
  });
  try {
    const started = await Promise.race([
      ready.then(code => {throw Error(`Validator exited (${code}): ${log}`);}),
      (async () => {
        for (let attempt=0;attempt<45;attempt++) {
          try {if (await connection.getSlot("confirmed") >= 5) return true;} catch { /* RPC not ready. */ }
          await delay(500);
        }
        throw Error(`Validator did not start: ${log}`);
      })(),
    ]);
    assert(started);
    for (const address of [TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,program]) {
      assert((await connection.getAccountInfo(address))?.executable,`Missing executable account ${address}`);
    }
    let attempt = 0;
    const send = async (tx: Transaction, ...signers: Keypair[]) => {
      // Distinct signatures let us test protocol replays within one blockhash window.
      tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({microLamports:++attempt}));
      const block = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = block.blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer, ...signers);
      const signature = await connection.sendRawTransaction(tx.serialize(),{preflightCommitment:"confirmed"});
      for (let check=0;check<40;check++) {
        const {value:[status]} = await connection.getSignatureStatuses([signature]);
        if (status?.err) throw Error(JSON.stringify(status.err));
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
        await delay(250);
      }
      throw Error(`Local transaction did not confirm: ${signature}`);
    };
    const source = getAssociatedTokenAddressSync(devnetMint,payer.publicKey);
    const recipientAccount = getAssociatedTokenAddressSync(devnetMint,recipient);
    await send(new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,source,payer.publicKey,devnetMint),
      createMintToInstruction(devnetMint,source,payer.publicKey,20_000_000n),
    ));
    await send(configurePolicy(program,payer.publicKey,3_000_000n,3));
    const draft = parseLiveInstruction(`Hold 2 USDC for ${recipient.toBase58()} until I approve the files.`,payer.publicKey);
    await send(fundEscrow(program,payer.publicKey,draft));
    let state = await fetchDevnet(connection,program,payer.publicKey);
    const [escrow] = state.outgoing;
    assert.equal(escrow.status,1);
    assert.equal(escrow.condition,"I approve the files");
    assert.equal(state.balance,18_000_000n);
    assert.equal(state.policy?.committed,2_000_000n);
    assert.equal((await getAccount(connection,escrow.vault)).amount,2_000_000n);
    await assert.rejects(send(fundEscrow(program,payer.publicKey,draft)), /custom program error/);
    await assert.rejects(send(manageEscrow(program,payer.publicKey,escrow,"release")), /custom program error/);
    await send(manageEscrow(program,payer.publicKey,escrow,"attest"));
    await send(configurePolicy(program,payer.publicKey,3_000_000n,7));
    await assert.rejects(send(manageEscrow(program,payer.publicKey,escrow,"release")), /custom program error/);
    await send(configurePolicy(program,payer.publicKey,3_000_000n,3));
    const misdirected = manageEscrow(program,payer.publicKey,escrow,"release");
    misdirected.instructions.at(-1)!.keys[4].pubkey = source;
    await assert.rejects(send(misdirected), /invalid account data/i);
    await send(manageEscrow(program,payer.publicKey,escrow,"release"));
    assert.equal((await getAccount(connection,recipientAccount)).amount,2_000_000n);
    await assert.rejects(send(manageEscrow(program,payer.publicKey,escrow,"release")), /custom program error/);
    const second = parseLiveInstruction(`Hold 1 USDC for ${recipient.toBase58()} until I sign off.`,payer.publicKey);
    await send(fundEscrow(program,payer.publicKey,second));
    state = await fetchDevnet(connection,program,payer.publicKey);
    const refund = state.outgoing.find(entry=>entry.status===1);
    assert(refund);
    await send(manageEscrow(program,payer.publicKey,refund,"cancel"));
    state = await fetchDevnet(connection,program,payer.publicKey);
    assert.equal(state.balance,18_000_000n);
    assert.equal(state.policy?.committed,2_000_000n);
    assert.deepEqual(state.outgoing.map(entry=>entry.status).sort(),[3,4]);
    console.log("On-chain escrow passed: fund, cap, attestation, pause, recipient validation, release, duplicate rejection, cancellation.");
    process.env.AVA_DEVNET_PROGRAM = program.toBase58();
    process.env.AVA_JUDGE_PAYER_KEYPAIR = JSON.stringify([...payer.secretKey]);
    process.env.AVA_JUDGE_RECIPIENT_ADDRESS = recipientSigner.publicKey.toBase58();
    delete process.env.AVA_JUDGE_ACCESS_CODE;

    const allowLocalReservation = async () => {};
    // Exercise the production signer and instruction path with the local validator
    // and a fixture mint. Only its genesis identity is substituted for this test.
    const localJudge = new Proxy(connection,{
      get(target,property,receiver) {
        if (property==="getGenesisHash") return async ()=>devnetGenesis;
        const value=Reflect.get(target,property,receiver);
        return typeof value==="function" ? value.bind(target) : value;
      },
    });
    for (const action of ["release","cancel"] as const) {
      const requestId = randomBytes(16).toString("hex");
      const payload = {requestId,condition:`Judge integration: ${action}`};
      const rejectReservation = async () => {throw new Error("daily cap reached");};
      await assert.rejects(runJudgeAction("fund",payload,localJudge,undefined,rejectReservation),/daily cap reached/);
      const funded = await runJudgeAction("fund",payload,localJudge,undefined,allowLocalReservation);
      assert.equal(funded.amount,"0.10");
      assert.equal(funded.explorerUrl,`https://explorer.solana.com/tx/${funded.signature}?cluster=devnet`);
      assert.equal((await runJudgeAction("fund",payload,localJudge,undefined,allowLocalReservation)).signature,funded.signature);
      await assert.rejects(runJudgeAction("cancel",{requestId,proof:"wrong"},localJudge),/does not belong/);
      const authorized = {requestId,proof:funded.proof};
      if (action==="release") {
        await assert.rejects(runJudgeAction("release",authorized,localJudge),/unavailable/);
        assert((await runJudgeAction("attest",authorized,localJudge)).signature);
      }
      const completed = await runJudgeAction(action,authorized,localJudge);
      assert.equal((await runJudgeAction(action,authorized,localJudge)).signature,completed.signature);
    }
    assert.equal((await getAccount(connection,recipientAccount)).amount,2_100_000n);
    assert.equal((await getAccount(connection,source)).amount,17_900_000n);
    console.log("Sponsored judge flows passed: confirmed release and refund, capability enforcement, Explorer receipts, idempotent retry.");
    const arbiter = Keypair.generate();
    const chainTime = async () => Number((await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY))!.data.readBigInt64LE(32));
    const waitPast = async (time: number) => {
      for (let i = 0; i < 120; i++) {
        if (await chainTime() >= time) return;
        await delay(250);
      }
      throw Error("Local validator clock did not advance.");
    };
    const readTimed = async (key: typeof recipient) => storedEscrow(key, (await connection.getAccountInfo(key))!.data);
    const timed = async (deliveryDeadline: number, reviewWindowSecs: number, withArbiter = true) => {
      const parsed = parseLiveInstruction(`Hold 0.10 USDC for ${recipient} until files arrive, give them 3 days to review.`, payer.publicKey);
      assert.equal(parsed.terms?.reviewWindowSecs, 259200);
      assert.equal(parsed.condition, "files arrive");
      const next = {...parsed, terms:{deliveryDeadline, reviewWindowSecs, arbiter:withArbiter ? arbiter.publicKey : null}};
      await send(fundEscrow(program, payer.publicKey, next));
      return readTimed(escrowAddress(program,payer.publicKey,next.nonce));
    };
    const payerAction = (escrow: Awaited<ReturnType<typeof timed>>, action: "refund" | "dispute" | "resolveRelease") =>
      send(manageTimedEscrow(program, payer.publicKey, escrow, action));
    const recipientAction = (escrow: Awaited<ReturnType<typeof timed>>, action: "deliver" | "claim") =>
      send(manageTimedEscrow(program, recipient, escrow, action),recipientSigner);

    await send(configurePolicy(program,payer.publicKey,10_000_000n,3));
    const beforeRecipient = (await getAccount(connection,recipientAccount)).amount;
    const beforePayer = (await getAccount(connection,source)).amount;
    const beforeCommitted = (await fetchDevnet(connection,program,payer.publicKey)).policy!.committed;
    const timeout = await timed(await chainTime() + 90, 8);
    const neverDelivered = await timed(await chainTime() + 8, 60);
    assert.equal((await fetchDevnet(connection,program,recipient)).incoming.find(x => x.key.equals(timeout.key))?.terms?.reviewWindowSecs,8);
    await assert.rejects(payerAction(neverDelivered,"refund"), /error: 0xc\b/);
    await assert.rejects(send(manageTimedEscrow(program,payer.publicKey,timeout,"deliver")), /error: 0xb\b/);
    await recipientAction(timeout,"deliver");
    const delivered = await readTimed(timeout.key);
    assert.equal(delivered.status,5);
    await assert.rejects(recipientAction(timeout,"claim"), /error: 0xc\b/);
    await assert.rejects(payerAction(timeout,"refund"), /error: 0xe\b/);
    // The payer cannot block a recipient claim by pausing the agent.
    await send(configurePolicy(program,payer.publicKey,10_000_000n,7));
    await waitPast(Math.max(delivered.terms!.deliveredAt! + 8, neverDelivered.terms!.deliveryDeadline + 1));
    await assert.rejects(payerAction(timeout,"dispute"), /error: 0xd\b/);
    await recipientAction(timeout,"claim");
    assert.equal((await readTimed(timeout.key)).status,3);
    await assert.rejects(recipientAction(timeout,"claim"), /error: 0xe\b/);
    await assert.rejects(recipientAction(neverDelivered,"deliver"), /error: 0xd\b/);
    await payerAction(neverDelivered,"refund");
    assert.equal((await readTimed(neverDelivered.key)).status,4);
    await send(configurePolicy(program,payer.publicKey,10_000_000n,3));
    const noArbiter = await timed(await chainTime() + 90, 60, false);
    await recipientAction(noArbiter,"deliver");
    await assert.rejects(payerAction(noArbiter,"dispute"), /error: 0xf\b/);
    await send(manageEscrow(program,payer.publicKey,noArbiter,"release"));
    const undelivered = await timed(await chainTime() + 90, 60);
    await send(manageEscrow(program,payer.publicKey,undelivered,"release"));
    assert.equal((await readTimed(undelivered.key)).status,3);
    for (const release of [true,false]) {
      const held = await timed(await chainTime() + 90,60);
      await recipientAction(held,"deliver");
      await payerAction(held,"dispute");
      assert.equal((await readTimed(held.key)).terms?.disputed,true);
      await assert.rejects(payerAction(held,"resolveRelease"), /error: 0xb\b/);
      await assert.rejects(recipientAction(held,"claim"), /error: 0xe\b/);
      await assert.rejects(send(manageEscrow(program,payer.publicKey,held,"release")), /error: 0xe\b/);
      await assert.rejects(send(manageEscrow(program,payer.publicKey,held,"cancel")), /error: 0xe\b/);
      const resolution = manageTimedEscrow(program,arbiter.publicKey,held,release ? "resolveRelease" : "resolveRefund");
      const redirected = await timed(await chainTime() + 90,60);
      resolution.instructions.at(-1)!.keys[5].pubkey = redirected.vault;
      await assert.rejects(send(resolution,arbiter));
      await send(manageTimedEscrow(program,arbiter.publicKey,held,release ? "resolveRelease" : "resolveRefund"),arbiter);
      assert.equal((await readTimed(held.key)).status,release ? 3 : 4);
      assert.equal((await getAccount(connection,held.vault)).amount,0n);
      await send(manageEscrow(program,payer.publicKey,redirected,"release"));
    }
    assert.equal((await getAccount(connection,recipientAccount)).amount,beforeRecipient + 600_000n);
    assert.equal((await getAccount(connection,source)).amount,beforePayer - 600_000n);
    assert.equal((await fetchDevnet(connection,program,payer.publicKey)).policy?.committed,beforeCommitted + 600_000n);
    console.log("Timed flows passed: delivery, timeout claim, deadline refund, early release, dispute freeze and both arbiter outcomes.");
    // Allow web3.js to close the last subscription before stopping the validator.
    await delay(700);
  } finally {
    validator.kill("SIGTERM");
    await ready.catch(()=>null);
    await rm(ledger,{recursive:true,force:true});
  }
}

void main().catch(error => {console.error(error);process.exitCode=1;});
