// Campaign 3 (Clodo test): runs Clodo People Search, Deep Search and Email Enrichment under a hard credit
// cap. Every call is recorded in artifacts/campaign-3-leads/clodo-ledger.json before it is made, and a
// call is refused if the ledger plus its worst-case cost would pass CREDIT_CAP. Results are fetched by
// polling (free); the webhook URL only exists because Clodo requires one.
// Usage:
//   node scripts/campaign3-clodo.mjs people --max 25 [--continue <job_id>]
//   node scripts/campaign3-clodo.mjs deep [--mode standard|extended]
//   node scripts/campaign3-clodo.mjs enrich --file <json array of {key, professional_url | first_name,last_name,domain}>
//   node scripts/campaign3-clodo.mjs ledger

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

// Thomas approved $22 for this test (1,100 credits at $0.02); the account balance is 1,250.
const CREDIT_CAP = 1100;
const BASE = "https://api-public.clodo.ai/api/public/v1";
const WEBHOOK_URL = "https://clodo-webhook.thomas-aed.workers.dev/";
const QUERY =
  "Owners, founders, medical directors or practice managers of independent cash-pay functional medicine, integrative medicine or longevity clinics in the United States, 2-50 employees. Exclude hospitals, health systems, insurance-based primary care and supplement brands.";
const DIR = path.join(__dirname, "..", "artifacts", "campaign-3-leads");
const LEDGER = path.join(DIR, "clodo-ledger.json");
const DEEP_COST = { standard: 200, extended: 400 };
const EMAIL_COST = 5;

const args = process.argv.slice(2);
const command = args[0];
const option = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
fs.mkdirSync(DIR, { recursive: true });

const readLedger = () => (fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : []);
const writeLedger = (entries) => fs.writeFileSync(LEDGER, JSON.stringify(entries, null, 2));
const committed = (entries) => entries.reduce((sum, entry) => sum + (entry.creditsCharged ?? entry.creditsReserved), 0);

function reserve(endpoint, credits, note) {
  const entries = readLedger();
  const used = committed(entries);
  if (used + credits > CREDIT_CAP) {
    throw new Error(`refused: ${endpoint} could cost ${credits} credits; ledger already at ${used} of the ${CREDIT_CAP} cap`);
  }
  const entry = { at: new Date().toISOString(), endpoint, creditsReserved: credits, creditsCharged: null, note };
  entries.push(entry);
  writeLedger(entries);
  return entries.length - 1;
}

function settle(index, fields) {
  const entries = readLedger();
  Object.assign(entries[index], fields);
  writeLedger(entries);
}

async function clodo(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: { "x-api-key": process.env.CLODO_API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

async function poll(route, intervalMs) {
  for (;;) {
    const { status, json, text } = await clodo("GET", route);
    if (status !== 200) throw new Error(`poll ${route}: ${status} ${text.slice(0, 300)}`);
    if (["completed", "failed", "cancelled"].includes(json.status)) return json;
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function runSearch(kind) {
  const isDeep = kind === "deep";
  const mode = option("--mode", "extended");
  const max = Number(option("--max", 25));
  const continueFrom = option("--continue", null);
  const worstCase = isDeep ? DEEP_COST[mode] : max;
  if (!isDeep && (max < 25 || max > 100)) throw new Error("--max must be 25-100");
  const ledgerIndex = reserve(isDeep ? `deep-search:${mode}` : "people-search", worstCase, continueFrom ? `continues ${continueFrom}` : QUERY);
  const body = isDeep
    ? { query: QUERY, mode, webhook_url: WEBHOOK_URL }
    : { ...(continueFrom ? { search_id: continueFrom } : { query: QUERY }), max_results: max, webhook_url: WEBHOOK_URL };
  const { status, json, text } = await clodo("POST", isDeep ? "/deep-search/" : "/search/", body);
  if (status !== 202) {
    settle(ledgerIndex, { creditsCharged: 0, error: `${status} ${text.slice(0, 300)}` });
    throw new Error(`${status} ${text.slice(0, 500)}`);
  }
  const jobId = json.id;
  settle(ledgerIndex, { jobId });
  console.log(`job ${jobId} accepted; polling`);
  const job = await poll(`${isDeep ? "/deep-search/" : "/search/"}${jobId}/`, isDeep ? 30000 : 6000);
  console.log("");
  const results = job.result?.results || [];
  const charged = job.status === "completed" ? (isDeep ? worstCase : results.length) : 0;
  settle(ledgerIndex, { creditsCharged: charged, status: job.status, leadsReturned: results.length, error: job.error || undefined });
  const file = path.join(DIR, `clodo-${isDeep ? "deep" : "people"}-${jobId}.json`);
  fs.writeFileSync(file, JSON.stringify(job, null, 2));
  console.log(`${job.status}: ${results.length} leads, ${charged} credits; saved ${path.relative(process.cwd(), file)}`);
  console.log(`ledger total ${committed(readLedger())} / ${CREDIT_CAP} credits`);
}

async function runEnrich() {
  const people = JSON.parse(fs.readFileSync(option("--file"), "utf8"));
  const outFile = option("--file").replace(/\.json$/, "-emails.json");
  const done = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
  for (const person of people) {
    if (done[person.key]) continue;
    const ledgerIndex = reserve("email-enrichment", EMAIL_COST, person.key);
    const body = person.professional_url
      ? { professional_url: person.professional_url }
      : { first_name: person.first_name, last_name: person.last_name, domain: person.domain };
    const { status, json, text } = await clodo("POST", "/enrich/email/", body);
    // Clodo bills found and not-found lookups; bad input (400) and upstream errors (502) are free.
    const charged = status === 200 || status === 404 ? EMAIL_COST : 0;
    settle(ledgerIndex, { creditsCharged: charged, status });
    done[person.key] = { status, email: json?.email || null, error: status === 200 || status === 404 ? undefined : text.slice(0, 200) };
    fs.writeFileSync(outFile, JSON.stringify(done, null, 2));
    console.log(`${person.key}: ${status} ${json?.email || ""}`);
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  console.log(`ledger total ${committed(readLedger())} / ${CREDIT_CAP} credits`);
}

if (command === "people") await runSearch("people");
else if (command === "deep") await runSearch("deep");
else if (command === "enrich") await runEnrich();
else if (command === "ledger") {
  const entries = readLedger();
  for (const entry of entries) console.log(entry.at, entry.endpoint, entry.creditsCharged ?? `reserved ${entry.creditsReserved}`, entry.leadsReturned ?? "", entry.jobId || "");
  console.log(`total ${committed(entries)} / ${CREDIT_CAP} credits ($${(committed(entries) * 0.02).toFixed(2)})`);
} else console.log("usage: people | deep | enrich | ledger");
