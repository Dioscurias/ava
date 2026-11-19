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
const instructionStatuses = ["", "Holding", "Ready to release", "Released", "Cancelled"] as const;

export type LivePolicy = {flags: number; limit: bigint; committed: bigint};
export type LiveEscrow = {
  key: PublicKey; payer: PublicKey; recipient: PublicKey; vault: PublicKey;
  nonce: Buffer; amount: bigint; status: 1 | 2 | 3 | 4; condition: string;
};
export type LiveDraft = {recipient: PublicKey; amount: bigint; condition: string; nonce: Buffer};
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
  const draft = parsePayment(input);
  if (!draft) throw Error("Include the amount, a Solana wallet address, and a release condition.");
  let recipient: PublicKey;
  try {recipient = new PublicKey(draft.recipient);}
  catch {throw Error("Enter the recipient’s Solana wallet address in the instruction.");}
  if (!PublicKey.isOnCurve(recipient.toBytes()) || recipient.equals(owner)) throw Error("Use a different Solana wallet as the recipient.");
  if (draft.condition === "You confirm the release" || Buffer.byteLength(draft.condition) > 200 || !draft.condition.trim()) {
    throw Error("Include a release condition of up to 200 bytes.");
  }
  return {recipient, amount: BigInt(draft.amount) * 10_000n, condition:draft.condition, nonce:Buffer.from(crypto.getRandomValues(new Uint8Array(8)))};
}

export const describeEscrow = (escrow: LiveEscrow) => instructionStatuses[escrow.status];
export const explorer = (type: "address" | "tx", value: string) => `https://explorer.solana.com/${type}/${value}?cluster=devnet`;

function u64(value: bigint) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}

export function policyAddress(program: PublicKey, payer: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("policy"), payer.toBuffer()], program)[0];
}

export function storedEscrow(key: PublicKey, data: Buffer): LiveEscrow {
  const status = data[1];
  if (data.length !== escrowSize || data[0] !== 1 || status < 1 || status > 4) throw Error("Unexpected escrow account format.");
  return {
    key, status: status as LiveEscrow["status"],
    payer:new PublicKey(data.subarray(2,34)), recipient:new PublicKey(data.subarray(34,66)),
    vault:new PublicKey(data.subarray(66,98)), nonce:data.subarray(98,106),
    amount:data.readBigUInt64LE(106), condition:data.subarray(114).toString("utf8").replace(/\0+$/, ""),
  };
}

export async function fetchDevnet(connection: Connection, program: PublicKey, payer: PublicKey): Promise<LiveSnapshot> {
  const tokenAddress = getAssociatedTokenAddressSync(devnetMint, payer);
  const readEscrows = (offset: number) => connection.getProgramAccounts(program, {
    commitment:"confirmed", filters:[{dataSize:escrowSize},{memcmp:{offset, bytes:payer.toBase58()}}],
  });
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
  return new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer,vault,key,devnetMint),
    new TransactionInstruction({
      programId,
      keys:[account(payer,true,true),account(policyAddress(programId,payer),true),account(key,true),
        account(source,true),account(vault,true),account(TOKEN_PROGRAM_ID),account(SystemProgram.programId)],
      data:Buffer.concat([Buffer.from([1]),nonce,u64(draft.amount),draft.recipient.toBuffer(),Buffer.from(draft.condition)]),
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
