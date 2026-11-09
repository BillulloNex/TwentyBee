// Groups finished research-runner results that no verifier has taken yet into batches for verification subagents,
// and records the assignment so a lead is only handed out once. Prints one line per new batch: name and issues.
// Also writes created.json (issue -> campaign2PersonId) for campaign2-apply-verified.mjs.
// Usage: node scripts/campaign2-verify-batches.mjs [--size 8] [--min 8] [--release B03]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_DIR = path.join(__dirname, "..", "artifacts", "campaign-2-leads");
const RUNS_DIR = path.join(LEADS_DIR, "research-runs");
const VERIFY_DIR = path.join(LEADS_DIR, "verification-2026-11-07");
const ASSIGNED_FILE = path.join(VERIFY_DIR, "assigned.json");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const SIZE = Number(option("--size", 8));
const MIN = Number(option("--min", SIZE));

fs.mkdirSync(VERIFY_DIR, { recursive: true });
const assigned = fs.existsSync(ASSIGNED_FILE) ? JSON.parse(fs.readFileSync(ASSIGNED_FILE, "utf8")) : {};

const release = option("--release");
if (release) {
  delete assigned[release];
  fs.writeFileSync(ASSIGNED_FILE, JSON.stringify(assigned, null, 1));
  console.log("released", release);
  process.exit(0);
}

const results = fs.readdirSync(RUNS_DIR)
  .filter((file) => /^BEE-\d+\.json$/.test(file))
  .map((file) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, file), "utf8")))
  .filter((result) => !result.error);

fs.writeFileSync(
  path.join(VERIFY_DIR, "created.json"),
  JSON.stringify(results.map((result) => ({ identifier: result.issue, campaign2PersonId: result.campaign2PersonId })), null, 1),
);

const taken = new Set(Object.values(assigned).flat());
const waiting = results
  .filter((result) => !taken.has(result.issue))
  .sort((a, b) => a.cohort.localeCompare(b.cohort) || Number(a.issue.slice(4)) - Number(b.issue.slice(4)))
  .map((result) => result.issue);

let batchNumber = Object.keys(assigned).length;
while (waiting.length >= MIN && waiting.length > 0) {
  const name = "B" + String(++batchNumber).padStart(2, "0");
  assigned[name] = waiting.splice(0, SIZE);
  console.log(name, assigned[name].join(","));
}
fs.writeFileSync(ASSIGNED_FILE, JSON.stringify(assigned, null, 1));
console.error(`unassigned finished leads: ${waiting.length}; batches so far: ${Object.keys(assigned).length}`);
