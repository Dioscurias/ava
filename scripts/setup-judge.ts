import {mkdir, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, resolve} from "node:path";
import {getOrCreateAssociatedTokenAccount} from "@solana/spl-token";
import {clusterApiUrl, Connection, Keypair, PublicKey} from "@solana/web3.js";

const mint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const folder = resolve(process.env.AVA_JUDGE_KEYS_DIR || resolve(homedir(), ".config", "solana", "ava-judge"));
const keyFile = (name: string) => resolve(folder, name + ".json");

async function readSigner(name: string) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyFile(name), "utf8"))));
}

async function main() {
  const command = process.argv[2];
  if (!["generate", "accounts", "print-secret"].includes(command)) {
    throw new Error("Usage: setup-judge.ts generate | accounts | print-secret");
  }
  if (command === "generate") {
    // Exclusive directory creation prevents partial overwrite of an existing wallet pair.
    await mkdir(dirname(folder), {recursive: true, mode: 0o700});
    await mkdir(folder, {mode: 0o700});
    for (const name of ["payer", "recipient"]) {
      const signer = Keypair.generate();
      await writeFile(keyFile(name), JSON.stringify([...signer.secretKey]) + "\n", {mode: 0o600, flag: "wx"});
      console.log(`Judge ${name}: ${signer.publicKey.toBase58()}`);
    }
    console.log(`Private keypair files saved to ${folder}. Fund the payer before running accounts.`);
    return;
  }

  const payer = await readSigner("payer");
  if (command === "print-secret") {
    console.log(JSON.stringify([...payer.secretKey]));
    return;
  }
  const recipient = await readSigner("recipient");
  const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl("devnet"), "confirmed");
  if (await connection.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
    throw new Error("The configured RPC is outside Solana Devnet.");
  }
  if (await connection.getBalance(payer.publicKey) < 10_000_000) {
    throw new Error("Fund the judge payer with Devnet SOL before creating the USDC accounts.");
  }
  for (const [name, owner] of [["payer", payer], ["recipient", recipient]] as const) {
    const account = await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner.publicKey, false, "confirmed");
    console.log(`${name}: ${owner.publicKey.toBase58()} · USDC account: ${account.address.toBase58()}`);
  }
}

main().catch(error => {console.error(error instanceof Error ? error.message : "Judge setup failed."); process.exitCode = 1;});
