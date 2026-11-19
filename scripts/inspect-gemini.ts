import { mkdir, writeFile } from "node:fs/promises";

const base = "https://api.gemini.com/v1/prediction-markets/events";
const folder = new URL("../docs/gemini-samples/", import.meta.url);

async function fetchSample(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status} at ${url}`);
  return response.json();
}

async function save(name: string, raw: unknown) {
  await writeFile(new URL(`${name}.json`, folder), JSON.stringify(raw, null, 2) + "\n");
}

async function main() {
  await mkdir(folder, { recursive: true });
  const active = await fetchSample(`${base}?status=active&limit=20`);
  await save("active", active);
  const crypto = await fetchSample(`${base}?status=active&category=crypto&limit=500`);
  const btc = crypto.data.find((event: { contracts: { instrumentSymbol: string }[] }) =>
    event.contracts.some(({ instrumentSymbol }) => instrumentSymbol.includes("BTC05M")));
  const settledList = await fetchSample(`${base}?status=settled&category=crypto&limit=20`);
  const settled = settledList.data[0];
  const missing: string[] = [];

  for (const [name, event] of [["btc05m-active", btc], ["settled", settled]] as const) {
    if (!event) {
      missing.push(name);
      continue;
    }
    const detail = await fetchSample(`${base}/${encodeURIComponent(event.ticker)}`);
    await save(name, detail);
    for (const contract of detail.contracts) {
      const { instrumentSymbol, prices, status, marketState, expiryDate, resolutionSide, resolvedAt } = contract;
      console.log({ instrumentSymbol, prices, status, marketState, expiryDate, resolutionSide, resolvedAt });
    }
  }
  if (missing.length) throw new Error(`No Gemini event found for ${missing.join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
