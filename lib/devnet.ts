import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type TransactionSignature,
} from "@solana/web3.js";
import {parsePayment} from "./payments";

export const devnetMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const devnetGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const devnetProgram = process.env.NEXT_PUBLIC_AVA_DEVNET_PROGRAM
  ? new PublicKey(process.env.NEXT_PUBLIC_AVA_DEVNET_PROGRAM)
  : null;
const escrowSize = 314;
const timedEscrowSize = 371;
const instructionStatuses = ["", "Holding", "Ready to release", "Released", "Cancelled"] as const;

export type LivePolicy = {flags: number; limit: bigint; committed: bigint};
export type LiveEscrow = {
  key: PublicKey; payer: PublicKey; recipient: PublicKey; vault: PublicKey;
  nonce: Buffer; amount: bigint; status: 1 | 2 | 3 | 4 | 5 | 6; condition: string;
  terms?: LiveTerms & {deliveredAt: number | null; disputed: boolean};
};
export type LiveTerms = {deliveryDeadline: number; reviewWindowSecs: number; arbiter: PublicKey | null};
export type LiveDraft = {recipient: PublicKey; amount: bigint; condition: string; nonce: Buffer; terms?: LiveTerms};
export type LiveSnapshot = {balance: bigint; policy: LivePolicy | null; outgoing: LiveEscrow[]; incoming: LiveEscrow[]};

export function toBaseUnits(value: string): bigint {
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(value)) throw Error("Enter a USDC amount with up to six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function formatBaseUnits(amount: bigint): string {
  const decimal = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${(amount / 1_000_000n).toLocaleString("en-US")}.${decimal}`;
}

export function parseLiveInstruction(input: string, owner: PublicKey): LiveDraft {
  const review = input.match(/(?:[,;.]\s*|\s+)give (?:them|the payer) (\d+) (seconds?|minutes?|hours?|days?) to review[.!]?$/i);
  const draft = parsePayment(review ? input.slice(0, review.index).trim() : input);
  if (!draft) throw Error("Include the amount, a Solana wallet address, and a release condition.");
  let recipient: PublicKey;
  try {recipient = new PublicKey(draft.recipient);}
  catch {throw Error("Enter the recipient’s Solana wallet address in the instruction.");}
  if (!PublicKey.isOnCurve(recipient.toBytes()) || recipient.equals(owner)) throw Error("Use a different Solana wallet as the recipient.");
  if (draft.condition === "You confirm the release" || Buffer.byteLength(draft.condition) > 200 || !draft.condition.trim()) {
    throw Error("Include a release condition of up to 200 bytes.");
  }
  const units = {second:1, minute:60, hour:3600, day:86400};
  const reviewWindowSecs = review ? Number(review[1]) * units[review[2].toLowerCase().replace(/s$/, "") as keyof typeof units] : null;
  if (reviewWindowSecs !== null && (reviewWindowSecs < 1 || reviewWindowSecs > 30 * 86400)) {
    throw Error("Set a review window between one second and 30 days.");
  }
  const terms = reviewWindowSecs === null ? undefined : {
    deliveryDeadline:Math.floor(Date.now() / 1000) + 7 * 86400, reviewWindowSecs, arbiter:null,
  };
  return {recipient, amount: BigInt(draft.amount) * 10_000n, condition:draft.condition, nonce:Buffer.from(crypto.getRandomValues(new Uint8Array(8))), ...(terms && {terms})};
}

export const describeEscrow = (escrow: LiveEscrow) => {
  if (escrow.terms) {
    return {1:"Funded", 2:"Ready to release", 3:"Released", 4:"Refunded", 5:"Delivered", 6:"Disputed"}[escrow.status];
  }
  return instructionStatuses[escrow.status as 1 | 2 | 3 | 4];
};
export const timedPaymentPath = (address: PublicKey) => `/payments/SOL-${address.toBase58()}`;
export const explorer = (type: "address" | "tx", value: string) => `https://explorer.solana.com/${type}/${value}?cluster=devnet`;

function u64(value: bigint) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}

function i64(value: number) {
  const data = Buffer.alloc(8);
  data.writeBigInt64LE(BigInt(value));
  return data;
}

export function policyAddress(program: PublicKey, payer: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("policy"), payer.toBuffer()], program)[0];
}

export function storedEscrow(key: PublicKey, data: Buffer): LiveEscrow {
  const status = data[1];
  const timed = data.length === timedEscrowSize && data[0] === 2 && [1, 3, 4, 5, 6].includes(status);
  const legacy = data.length === escrowSize && data[0] === 1 && status >= 1 && status <= 4;
  if (!timed && !legacy) throw Error("Unexpected escrow account format.");
  const arbiter = timed ? new PublicKey(data.subarray(339,371)) : null;
  return {
    key, status: status as LiveEscrow["status"],
    payer:new PublicKey(data.subarray(2,34)), recipient:new PublicKey(data.subarray(34,66)),
    vault:new PublicKey(data.subarray(66,98)), nonce:data.subarray(98,106),
    amount:data.readBigUInt64LE(106), condition:data.subarray(114, escrowSize).toString("utf8").replace(/\0+$/, ""),
    ...(timed && {terms: {
      deliveryDeadline:Number(data.readBigInt64LE(314)),
      reviewWindowSecs:Number(data.readBigInt64LE(322)),
      deliveredAt:Number(data.readBigInt64LE(330)) || null,
      disputed:data[338] !== 0,
      arbiter:arbiter && !arbiter.equals(PublicKey.default) ? arbiter : null,
    }}),
  };
}

export async function fetchDevnet(connection: Connection, program: PublicKey, payer: PublicKey): Promise<LiveSnapshot> {
  const tokenAddress = getAssociatedTokenAddressSync(devnetMint, payer);
  const readEscrows = async (offset: number) => (await Promise.all([escrowSize, timedEscrowSize].map(size =>
    connection.getProgramAccounts(program, {
      commitment:"confirmed", filters:[{dataSize:size},{memcmp:{offset, bytes:payer.toBase58()}}],
    })
  ))).flat();
  const [policy, token, outgoing, incoming] = await Promise.all([
    connection.getAccountInfo(policyAddress(program, payer), "confirmed"),
    connection.getAccountInfo(tokenAddress, "confirmed"),
    readEscrows(2), readEscrows(34),
  ]);
  if (policy && (!policy.owner.equals(program) || policy.data.length !== 18 || policy.data[0] !== 1)) {
    throw Error("The connected wallet’s policy account could not be read.");
  }
  return {
    balance: token ? unpackAccount(tokenAddress, token).amount : 0n,
    policy: policy ? {flags:policy.data[1], limit:policy.data.readBigUInt64LE(2), committed:policy.data.readBigUInt64LE(10)} : null,
    outgoing: outgoing.map(({pubkey,account}) => storedEscrow(pubkey, account.data)),
    incoming: incoming.map(({pubkey,account}) => storedEscrow(pubkey, account.data)),
  };
}

const account = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({pubkey,isWritable,isSigner});

export function configurePolicy(programId: PublicKey, payer: PublicKey, limit: bigint, flags: number) {
  return new Transaction().add(new TransactionInstruction({
    programId,
    keys:[account(payer, true, true),account(policyAddress(programId,payer),true),account(SystemProgram.programId)],
    data:Buffer.concat([Buffer.from([0,flags]),u64(limit)]),
  }));
}

export function escrowAddress(programId: PublicKey, payer: PublicKey, nonce: Buffer) {
  return PublicKey.findProgramAddressSync([Buffer.from("escrow"), payer.toBuffer(), nonce], programId)[0];
}

export function fundEscrow(programId: PublicKey, payer: PublicKey, draft: LiveDraft) {
  const {nonce} = draft;
  const key = escrowAddress(programId,payer,nonce);
  const source = getAssociatedTokenAddressSync(devnetMint,payer);
  const vault = getAssociatedTokenAddressSync(devnetMint,key,true);
  const terms = draft.terms ? [
    i64(draft.terms.deliveryDeadline), i64(draft.terms.reviewWindowSecs),
    (draft.terms.arbiter ?? PublicKey.default).toBuffer(),
  ] : [];
  return new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer,vault,key,devnetMint),
    new TransactionInstruction({
      programId,
      keys:[account(payer,true,true),account(policyAddress(programId,payer),true),account(key,true),
        account(source,true),account(vault,true),account(TOKEN_PROGRAM_ID),account(SystemProgram.programId)],
      data:Buffer.concat([Buffer.from([draft.terms ? 5 : 1]),nonce,u64(draft.amount),draft.recipient.toBuffer(),...terms,Buffer.from(draft.condition)]),
    }),
  );
}

export function manageEscrow(programId: PublicKey, payer: PublicKey, escrow: LiveEscrow, action: "attest" | "release" | "cancel") {
  const op = {attest:2, release:3, cancel:4}[action];
  const keys = [account(payer,true,true),account(policyAddress(programId,payer),op===4),account(escrow.key,true)];
  const transaction = new Transaction();
  if (op !== 2) {
    const recipient = op === 3 ? escrow.recipient : payer;
    const destination = getAssociatedTokenAddressSync(devnetMint,recipient);
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(payer,destination,recipient,devnetMint));
    keys.push(account(escrow.vault,true),account(destination,true),account(TOKEN_PROGRAM_ID));
  }
  return transaction.add(new TransactionInstruction({programId,keys,data:Buffer.concat([Buffer.from([op]),escrow.nonce])}));
}

export type TimedAction = "deliver" | "claim" | "refund" | "dispute" | "resolveRelease" | "resolveRefund";

export function manageTimedEscrow(programId: PublicKey, actor: PublicKey, escrow: LiveEscrow, action: TimedAction) {
  const op = {deliver:6, claim:7, refund:8, dispute:9, resolveRelease:10, resolveRefund:10}[action];
  const refund = action === "refund" || action === "resolveRefund";
  const keys = [
    account(escrow.payer), account(policyAddress(programId,escrow.payer),refund),
    account(escrow.key,true), account(actor,true,true),
  ];
  const transaction = new Transaction();
  if (op === 7 || op === 8 || op === 10) {
    const owner = refund ? escrow.payer : escrow.recipient;
    const destination = getAssociatedTokenAddressSync(devnetMint,owner);
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(actor,destination,owner,devnetMint));
    keys.push(account(escrow.vault,true),account(destination,true),account(TOKEN_PROGRAM_ID));
  }
  const suffix = op === 10 ? Buffer.from([refund ? 0 : 1]) : Buffer.alloc(0);
  return transaction.add(new TransactionInstruction({programId,keys,data:Buffer.concat([Buffer.from([op]),escrow.nonce,suffix])}));
}

export async function confirmDevnetTransaction(
  connection: Connection, programId: PublicKey, transaction: Transaction, payer: PublicKey,
  send: (transaction: Transaction, connection: Connection) => Promise<TransactionSignature>,
  onSubmitted: (signature: TransactionSignature) => void,
) {
  const [network, program] = await Promise.all([connection.getGenesisHash(), connection.getAccountInfo(programId, "confirmed")]);
  if (network !== devnetGenesis || !program?.executable) throw Error("Ava’s escrow program is unavailable on Solana Devnet.");
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = payer;
  transaction.recentBlockhash = latest.blockhash;
  const signature = await send(transaction, connection);
  onSubmitted(signature);
  const result = await connection.confirmTransaction({...latest,signature},"confirmed");
  if (result.value.err) throw Error("Solana rejected the transaction. Check its Explorer details.");
  return signature;
}
