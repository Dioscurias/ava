import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { PublicKey } from "@solana/web3.js";

const network = "solana-devnet";
const dataset = "programs_with_logs";
const base = "https://api.quicknode.com/streams/rest/v1/streams";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

async function request(path: string, method: string, body?: object) {
  const response = await fetch(base + path, {
    method,
    headers: { "x-api-key": env("QUICKNODE_API_KEY"), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`QuickNode ${method} failed with HTTP ${response.status}`);
  if (response.status === 204) return;
  const raw = await response.text();
  if (!raw) return;
  const result = JSON.parse(raw);
  // Never print destination URLs, the query secret, or the security token.
  console.log({ id: result.id, status: result.status, network: result.network, dataset: result.dataset });
  return result;
}

async function main() {
  const [command, parameter] = process.argv.slice(2);
  if (command === "test-filter" || command === "create") {
    const template = await readFile(new URL("../streams/filter.js", import.meta.url), "utf8");
    const sample = JSON.parse(await readFile(new URL("../streams/sample.json", import.meta.url), "utf8"));
    if (command === "test-filter" && !parameter) {
      const fixture = sample.data[0][0];
      const code = template.replace("__ESCROW_PROGRAM_ID__", fixture.programInvocations[0].programId);
      const actual = runInNewContext(code + "\nmain(sample)", { sample });
      if (actual?.length !== 1 || actual[0].signature !== fixture.signature) throw new Error("Sample did not match");
      console.log(JSON.stringify(actual));
      return;
    }
    const program = new PublicKey(process.env.ESCROW_PROGRAM_ID || env("AVA_DEVNET_PROGRAM")).toBase58();
    const filter_function = Buffer.from(template.replace("__ESCROW_PROGRAM_ID__", program)).toString("base64");
    if (command === "test-filter") {
      const result = await request("/test_filter", "POST", { network, dataset, filter_function, block: parameter });
      console.log(JSON.stringify(result));
      return;
    }
    console.error("WARNING: Solana Devnet is high volume. Create this Stream only for testing or a demo. Pause it afterward.");
    const url = new URL("/api/webhooks/quicknode", env("PUBLIC_BASE_URL"));
    if (url.protocol !== "https:") throw new Error("PUBLIC_BASE_URL must use HTTPS");
    url.searchParams.set("k", env("QUICKNODE_WEBHOOK_SECRET"));
    await request("", "POST", {
      name: "Ava escrow Devnet", network, dataset, filter_function,
      region: "usa_east", dataset_batch_size: 1, elastic_batch_enabled: false,
      destination: "webhook", status: "active",
      destination_attributes: {
        url: url.href, security_token: env("QUICKNODE_SECURITY_TOKEN"), compression: "none",
        headers: {}, max_retry: 3, retry_interval_sec: 1, post_timeout_sec: 10,
      },
    });
    return;
  }
  if (!parameter || !["status", "pause", "resume", "delete"].includes(command)) {
    throw new Error("Usage: quicknode-stream.ts create | test-filter [slot] | status|pause|resume|delete ID");
  }
  const id = "/" + encodeURIComponent(parameter);
  if (command === "pause" || command === "resume") {
    await request(id + (command === "resume" ? "/activate" : "/pause"), "POST");
  } else {
    await request(id, command === "status" ? "GET" : "DELETE");
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
