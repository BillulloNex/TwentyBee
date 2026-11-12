// Campaign 3 step 3 (gather -> check -> write): hands checked gather results to writer agents (agy Sonnet by default, Pi as fallback) in batches,
// each following scripts/campaign3-writer-brief.md and writing artifacts/campaign-3-leads/write-runs/results-<n>.json.
// A batch whose results file already covers every lead is skipped, so reruns only redo failed batches.
// --revise: voice pass on finished drafts (scripts/campaign3-revise-brief.md); each batch gets the current drafts, latest results file winning.
// Usage: node scripts/campaign3-write.mjs [--revise] [--only C3-aaaa,C3-bbbb] [--tag r1] [--brief <file>] [--batch 5] [--concurrency 4] [--agent agy|pi] [--model <model>]

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const LEADS_DIR = path.join(__dirname, "..", "artifacts", "campaign-3-leads");
const GATHER_DIR = path.join(LEADS_DIR, "gather-runs");
// A second, social-listening pass by Antigravity agents; when present it is handed to the writer next to the first.
const AGY_DIR = path.join(LEADS_DIR, "gather-runs-agy");
const agyFile = (key) => {
  const file = path.join(AGY_DIR, key + ".json");
  return fs.existsSync(file) && !JSON.parse(fs.readFileSync(file, "utf8")).error ? file : null;
};
const OUT_DIR = path.join(LEADS_DIR, "write-runs");
const REVISE = args.includes("--revise");
const BRIEF = fs.readFileSync(option("--brief") ? path.resolve(option("--brief")) : path.join(__dirname, REVISE ? "campaign3-revise-brief.md" : "campaign3-writer-brief.md"), "utf8");
// Thomas's rule: Claude Code and Antigravity first; Pi (paid gateway) only when both are out of capacity.
const AGENT = option("--agent") ?? "agy";
const MODEL = option("--model") ?? (AGENT === "agy" ? "claude-sonnet-4-6" : "cloudflare-ai-gateway/claude-sonnet-5-5");
const BATCH = Number(option("--batch") ?? 5);
const CONCURRENCY = Number(option("--concurrency") ?? 4);
const only = option("--only")?.split(",");

const currentDrafts = new Map();
// Revisions start from the pre-voice drafts so a rerun never revises a revision.
for (const file of fs.readdirSync(OUT_DIR).filter((name) => /^results-.*\.json$/.test(name) && !name.startsWith("results-voice")).sort()) {
  for (const result of JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), "utf8"))) currentDrafts.set(result.key, result);
}

const keys = fs
  .readdirSync(GATHER_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""))
  .filter((key) => !JSON.parse(fs.readFileSync(path.join(GATHER_DIR, key + ".json"), "utf8")).error)
  .filter((key) => !only || only.includes(key))
  .filter((key) => !REVISE || (currentDrafts.has(key) && currentDrafts.get(key).verdict !== "FAIL"))
  .sort();

fs.mkdirSync(OUT_DIR, { recursive: true });
const batches = [];
for (let index = 0; index < keys.length; index += BATCH) batches.push({ id: batches.length + 1, keys: keys.slice(index, index + BATCH) });

// --tag keeps separate --only runs from overwriting each other's results files.
const TAG = option("--tag") ?? (REVISE ? "voice" : only ? "only" : "");
const resultsFile = (batch) => path.join(OUT_DIR, `results-${TAG ? TAG + "-" : ""}${batch.id}.json`);
const done = (batch) => {
  try {
    const written = new Set(JSON.parse(fs.readFileSync(resultsFile(batch), "utf8")).map((result) => result.key));
    return batch.keys.every((key) => written.has(key));
  } catch {
    return false;
  }
};

// The verified address belongs to the person on file, so the writer must greet them even when someone else owns the practice.
const recipients = new Map(JSON.parse(fs.readFileSync(path.join(LEADS_DIR, "leads-cache.json"), "utf8")).map((lead) => [lead.issue, lead]));

function prompt(batch) {
  const draftsFile = path.join(OUT_DIR, `drafts-${TAG}-${batch.id}.json`);
  if (REVISE) fs.writeFileSync(draftsFile, JSON.stringify(batch.keys.map((key) => currentDrafts.get(key)), null, 2));
  return [
    `Today is ${new Date().toISOString().slice(0, 10)}. Follow the brief below for these leads, one at a time:`,
    ...batch.keys.map((key) => {
      const lead = recipients.get(key);
      const recipient = lead ? ` (recipient on file: ${lead.name}, ${lead.jobTitle || "role unknown"}, ${lead.email}${lead.segment ? `; segment ${lead.segment}; story ${lead.caseStudy}` : ""})` : "";
      return `- ${path.join(GATHER_DIR, key + ".json")}${recipient}${agyFile(key) ? ` and its second evidence file ${agyFile(key)}` : ""}`;
    }),
    "",
    ...(REVISE ? [`Drafts file: ${draftsFile}`] : []),
    `Results file: ${resultsFile(batch)}`,
    AGENT === "agy"
      ? "Read the evidence files with your file tools and open web pages with your page reading tools. Write the results file with your file tools. Do not run terminal commands."
      : `Open pages with \`curl -sL -A "Mozilla/5.0" <url>\` and strip tags to read visible text, or \`node ${path.join(__dirname, "render-page.mjs")} <url>\` for JavaScript-built pages. Use the terminal only for those and to write the results file.`,
    "",
    BRIEF,
  ].join("\n");
}

function run(batch) {
  return new Promise((resolve) => {
    const [command, commandArgs, cwd] =
      AGENT === "agy"
        ? ["agy", ["-p", prompt(batch), "--model", MODEL, "--add-dir", LEADS_DIR, "--dangerously-skip-permissions", "--output-format", "json", "--print-timeout", "2400s"], fs.mkdtempSync(path.join(os.tmpdir(), "c3-write-"))]
        : ["pi", ["-p", "--model", MODEL, "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-mcp", "--mode", "json", prompt(batch)], undefined];
    const child = spawn(command, commandArgs, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), 40 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      let costUsd = 0;
      for (const line of output.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.type === "message_end" && event.message?.role === "assistant") costUsd += event.message.usage?.cost?.total ?? 0;
        } catch {}
      }
      resolve({ code, costUsd, tail: output.slice(-400) });
    });
  });
}

const queue = batches.filter((batch) => !done(batch));
console.log(`${new Date().toISOString()} writing ${queue.length} batches (${queue.reduce((sum, batch) => sum + batch.keys.length, 0)} leads) with ${AGENT} ${MODEL} x${CONCURRENCY}`);
let totalCost = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const batch = queue.shift();
      const { code, costUsd, tail } = await run(batch);
      totalCost += costUsd;
      console.log(`${new Date().toISOString()} batch ${batch.id} ${done(batch) ? "OK" : "INCOMPLETE exit " + code + " " + tail.replace(/\s+/g, " ").slice(-200)} $${costUsd.toFixed(2)}`);
    }
  }),
);
console.log(`total $${totalCost.toFixed(2)}`);
