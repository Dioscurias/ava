import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {readFileSync} from "node:fs";
import {getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID, unpackAccount} from "@solana/spl-token";
import {Connection, Keypair, PublicKey, clusterApiUrl, Transaction} from "@solana/web3.js";
import {configurePolicy, devnetGenesis, devnetMint, escrowAddress, explorer, formatBaseUnits, fundEscrow, manageEscrow, policyAddress, storedEscrow} from "./devnet";

export const judgeAmount = 100_000n;
const judgeSpendingCap = 5_000_000n;
const solReserve = 20_000_000;
const actions = {fund:1, attest:2, release:3, cancel:4} as const;
export type JudgeAction = keyof typeof actions;
export class JudgeError extends Error {
  constructor(message: string, readonly status: number) {super(message);}
}

function signer(role: "PAYER" | "RECIPIENT") {
  const value = process.env[`AVA_JUDGE_${role}_KEYPAIR`];
  const file = process.env[`AVA_JUDGE_${role}_KEYPAIR_PATH`];
  if (!value && !file) return null;
  try {
    const bytes: unknown = JSON.parse(value || readFileSync(file!, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 ||
        bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw Error();
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {throw new JudgeError(`Judge ${role.toLowerCase()} keypair is invalid.`,503);}
}

function programAddress() {
  const value = process.env.AVA_DEVNET_PROGRAM || process.env.NEXT_PUBLIC_AVA_DEVNET_PROGRAM;
  try {return value ? new PublicKey(value) : null;}
  catch {throw new JudgeError("The configured escrow program address is invalid.",503);}
}

function rpcConnection() {
  return new Connection(process.env.AVA_DEVNET_RPC_URL || clusterApiUrl("devnet"),"confirmed");
}

async function assertNetwork(connection: Connection, program: PublicKey) {
  const [genesis,account] = await Promise.all([
    connection.getGenesisHash(),connection.getAccountInfo(program),
  ]);
  if (genesis !== devnetGenesis) throw new JudgeError("The configured RPC is outside Solana Devnet.",503);
  if (!account?.executable) throw new JudgeError("The escrow program is not deployed at the configured address on Devnet.",503);
}

async function balance(connection: Connection, owner: PublicKey) {
  const ata = getAssociatedTokenAddressSync(devnetMint,owner);
  const [lamports,tokenAccount] = await Promise.all([connection.getBalance(owner),connection.getAccountInfo(ata)]);
  const testUsdc = tokenAccount ? unpackAccount(ata,tokenAccount).amount : 0n;
  return {address:owner.toBase58(),sol:lamports / 1_000_000_000,testUsdc:formatBaseUnits(testUsdc),lamports,testUsdcRaw:testUsdc.toString()};
}

export async function getJudgeStatus() {
  const connection = rpcConnection();
  const program = programAddress();
  const payer = signer("PAYER");
  const recipient = signer("RECIPIENT");
  const base = {
    cluster:"devnet", programId:program?.toBase58() ?? null, programExecutable:false,
    programExplorerUrl:program ? explorer("address",program.toBase58()) : null,
    mint:devnetMint.toBase58(), classicSpl:false, decimals:null as number | null,
    rpc:{healthy:false,slot:null as number | null},
    judge:{configured:Boolean(payer && recipient && !payer.publicKey.equals(recipient.publicKey)),ready:false,
      accessCodeRequired:Boolean(process.env.AVA_JUDGE_ACCESS_CODE),
      payer:payer ? {address:payer.publicKey.toBase58(),sol:null as number | null,testUsdc:null as string | null} : null,
      recipient:recipient ? {address:recipient.publicKey.toBase58(),sol:null as number | null,testUsdc:null as string | null} : null},
    error:null as string | null,
  };
  try {
    const [genesis,slot] = await Promise.all([connection.getGenesisHash(),connection.getSlot()]);
    if (genesis !== devnetGenesis) return {...base,error:"The configured RPC is outside Solana Devnet."};
    const [programInfo,mint,payerBalance,recipientBalance] = await Promise.all([
      program ? connection.getAccountInfo(program) : null,
      getMint(connection,devnetMint,"confirmed",TOKEN_PROGRAM_ID),
      payer ? balance(connection,payer.publicKey) : null,
      recipient ? balance(connection,recipient.publicKey) : null,
    ]);
    return {
      ...base, rpc:{healthy:true,slot}, programExecutable:Boolean(programInfo?.executable),
      classicSpl:true,decimals:mint.decimals,
      judge:{...base.judge,payer:payerBalance,recipient:recipientBalance,
        ready:Boolean(base.judge.configured && programInfo?.executable && mint.decimals===6 && payerBalance &&
          payerBalance.lamports>=solReserve && BigInt(payerBalance.testUsdcRaw)>=judgeAmount)},
    };
  } catch {return {...base,error:"Devnet RPC verification failed."};}
}

function capability(payer: Keypair, program: PublicKey, nonce: Buffer) {
  return createHmac("sha256",payer.secretKey).update("ava:devnet:judge:v1").update(program.toBuffer()).update(nonce).digest("hex");
}

function equalSecret(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}

async function submit(connection: Connection, payer: Keypair, transaction: Transaction, scheduleFallback?: (signature: string, at: number) => void) {
  const block = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = payer.publicKey;
  transaction.recentBlockhash = block.blockhash;
  transaction.sign(payer);
  const submittedAt = Date.now();
  const signature = await connection.sendRawTransaction(transaction.serialize(),{preflightCommitment:"confirmed",maxRetries:3});
  scheduleFallback?.(signature, submittedAt);
  const confirmed = await connection.confirmTransaction({...block,signature},"confirmed");
  if (confirmed.value.err) throw new JudgeError("Solana rejected the transaction.",409);
  return signature;
}

async function findSignature(connection: Connection, program: PublicKey, escrow: PublicKey, opcode: number) {
  const signatures = await connection.getSignaturesForAddress(escrow,{limit:15},"confirmed");
  for (const entry of signatures) {
    if (entry.err) continue;
    const tx = await connection.getTransaction(entry.signature,{commitment:"confirmed",maxSupportedTransactionVersion:0});
    const message = tx?.transaction.message;
    if (message?.compiledInstructions.some(ix=>message.staticAccountKeys[ix.programIdIndex]?.equals(program) && ix.data[0]===opcode)) return entry.signature;
  }
  throw new JudgeError("The escrow updated, but its transaction history is not available yet. Retry shortly.",503);
}

export async function runJudgeAction(action: JudgeAction, payload: unknown, connection = rpcConnection(), scheduleFallback?: (signature: string, at: number) => void) {
  if (!payload || typeof payload !== "object") throw new JudgeError("Expected a JSON request.",400);
  const values = payload as Record<string,unknown>;
  const program = programAddress();
  const payer = signer("PAYER");
  const recipient = signer("RECIPIENT");
  if (!program || !payer || !recipient || payer.publicKey.equals(recipient.publicKey)) throw new JudgeError("Judge mode is not configured.",503);
  const accessCode = process.env.AVA_JUDGE_ACCESS_CODE;
  if (accessCode && (typeof values.accessCode !== "string" || !equalSecret(values.accessCode,accessCode))) {
    throw new JudgeError("Enter the judge access code.",401);
  }
  if (typeof values.requestId !== "string" || !/^[0-9a-f]{32}$/.test(values.requestId)) throw new JudgeError("Invalid escrow request ID.",400);
  const nonce = createHash("sha256").update(values.requestId,"hex").digest().subarray(0,8);
  const proof = capability(payer,program,nonce);
  if (action !== "fund" && (typeof values.proof !== "string" || !equalSecret(values.proof,proof))) {
    throw new JudgeError("This escrow does not belong to this judge session.",403);
  }
  await assertNetwork(connection,program);
  const key = escrowAddress(program,payer.publicKey,nonce);
  const existing = await connection.getAccountInfo(key);
  const escrow = existing?.owner.equals(program) ? storedEscrow(key,existing.data) : null;
  let signature: string;
  if (action==="fund") {
    const condition = typeof values.condition === "string" ? values.condition.trim() : "";
    if (!condition || condition.includes("\0") || Buffer.byteLength(condition)>200) {
      throw new JudgeError("Enter a public release condition of up to 200 bytes.",400);
    }
    if (escrow) {
      if (escrow.condition!==condition || escrow.amount!==judgeAmount || !escrow.recipient.equals(recipient.publicKey)) {
        throw new JudgeError("The request ID is already in use for different terms.",409);
      }
      signature = await findSignature(connection,program,key,actions.fund);
    } else {
      const funds = await balance(connection,payer.publicKey);
      if (funds.lamports<solReserve || BigInt(funds.testUsdcRaw)<judgeAmount) throw new JudgeError("The sponsor needs more Devnet SOL or test USDC.",503);
      const policy = policyAddress(program,payer.publicKey);
      const tx = new Transaction();
      if (!(await connection.getAccountInfo(policy))?.owner.equals(program)) {
        tx.add(configurePolicy(program,payer.publicKey,judgeSpendingCap,3));
      }
      tx.add(fundEscrow(program,payer.publicKey,{recipient:recipient.publicKey,amount:judgeAmount,condition,nonce}));
      signature = await submit(connection,payer,tx,scheduleFallback);
    }
  } else {
    if (!escrow || !escrow.payer.equals(payer.publicKey) || !escrow.recipient.equals(recipient.publicKey)) {
      throw new JudgeError("The funded escrow could not be found.",404);
    }
    const alreadyApplied = action==="attest" ? [2,3].includes(escrow.status) :
      escrow.status===(action==="release" ? 3 : 4);
    if (alreadyApplied) signature = await findSignature(connection,program,key,actions[action]);
    else {
      const allowed = action==="attest" ? escrow.status===1 : action==="release" ? escrow.status===2 : escrow.status<3;
      if (!allowed) throw new JudgeError("This action is unavailable in the escrow’s current state.",409);
      signature = await submit(connection,payer,manageEscrow(program,payer.publicKey,escrow,action),scheduleFallback);
    }
  }
  return {
    action, signature, explorerUrl:explorer("tx",signature), escrow:key.toBase58(),
    escrowExplorerUrl:explorer("address",key.toBase58()), requestId:values.requestId, proof,
    amount:formatBaseUnits(judgeAmount), recipient:recipient.publicKey.toBase58(),
  };
}
