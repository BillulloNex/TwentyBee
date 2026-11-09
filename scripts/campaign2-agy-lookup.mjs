// Fans out web lookups to the Antigravity CLI (Gemini Flash) for finder rows whose site is live but
// yielded no email from crawling or guessing. Only addresses the model saw published are accepted, and
// each is then checked with Reacher. Writes agyEmail / agySourceUrl / agyReacher onto the rows in place.
// Usage: node scripts/campaign2-agy-lookup.mjs artifacts/campaign-2-leads/email-finder-<stamp>.json [--limit N] [--model <agy model>]

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const args = process.argv.slice(2);
const MODEL = args.includes("--model") ? args[args.indexOf("--model") + 1] : "gemini-3.8-flash-low";
const [inputFile] = args.filter((arg, index) => !arg.startsWith("--") && !/^\d+$/.test(arg) && args[index - 1] !== "--model");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const CONCURRENCY = 5;
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agy-lookup-"));
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function prompt(row) {
  const who = row.name ? `${row.name} (${row.jobTitle || "decision maker"}) at ` : "";
  return [
    `Use your web search and page reading tools only (no terminal). Find a publicly published email address for ${who}"${row.companyName}", a practice whose website is ${row.host}${row.location ? ", located in " + row.location : ""}.`,
    `Prefer the named person's own address, then the practice's general inbox. Check the practice website, Google Business, Facebook About, Yelp and professional directories.`,
    `Never guess or construct an address. Only report one you actually saw published, with the URL where it appears.`,
    `Reply with only one line of JSON: {"email": "", "sourceUrl": "", "isPersonal": false}. Leave email empty if none was found.`,
  ].join(" ");
}

async function lookup(row) {
  try {
    const { stdout } = await run(
      "agy",
      ["-p", prompt(row), "--model", MODEL, "--sandbox", "--dangerously-skip-permissions", "--output-format", "json", "--print-timeout", "240s"],
      { cwd: WORK_DIR, timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
    );
    const response = JSON.parse(stdout.slice(stdout.indexOf("{"))).response ?? "";
    const answer = JSON.parse(response.slice(response.indexOf("{"), response.lastIndexOf("}") + 1));
    const email = String(answer.email || "").trim().toLowerCase();
    return EMAIL_PATTERN.test(email) ? { agyEmail: email, agySourceUrl: answer.sourceUrl || "", agyPersonal: Boolean(answer.isPersonal) } : { agyEmail: "", agySourceUrl: "" };
  } catch (error) {
    return { agyEmail: "", agyError: String((error.stdout || "") + error.message).match(/RESOURCE_EXHAUSTED|exhausted your capacity/)?.[0] ?? String(error.message).slice(0, 120) };
  }
}

async function reacher(email) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch((process.env.REACHER_URL || "http://reacher.beenex.org") + "/v0/check_email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-reacher-secret": process.env.REACHER_SECRET },
      body: JSON.stringify({ to_email: email }),
      signal: AbortSignal.timeout(120000),
    }).catch(() => null);
    if (res?.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 20000 * attempt));
      continue;
    }
    if (!res?.ok) continue;
    const result = await res.json();
    const flags = [result.smtp?.is_catch_all && "catch-all", result.misc?.is_role_account && "role"].filter(Boolean).join(",");
    return { agyReacher: result.is_reachable, agyReacherDetail: flags };
  }
  return { agyReacher: "error" };
}

const report = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const pending = report.rows
  .filter((row) => row.siteReachable && !row.email && !row.guessedEmail && (row.agyEmail === undefined || row.agyError))
  .slice(0, LIMIT);
console.log(`agy lookups: ${pending.length}`);
let next = 0;
let done = 0;
let quotaExhausted = false;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < pending.length && !quotaExhausted) {
    const row = pending[next++];
    delete row.agyError;
    Object.assign(row, await lookup(row), { agyModel: MODEL });
    // A spent Gemini quota fails every call for hours; stop instead of marking the rest as errors.
    if (/RESOURCE_EXHAUSTED|exhausted your capacity/.test(row.agyError ?? "")) {
      quotaExhausted = true;
      console.log("Gemini quota exhausted; rerun this script after it resets.");
    }
    if (row.agyEmail) Object.assign(row, await reacher(row.agyEmail));
    if (++done % 10 === 0) {
      console.log(`  ${done}/${pending.length}`);
      fs.writeFileSync(inputFile, JSON.stringify(report, null, 1));
    }
  }
}));
fs.writeFileSync(inputFile, JSON.stringify(report, null, 1));
const tally = pending.reduce((counts, row) => {
  const key = row.agyError ? "ERROR" : row.agyEmail ? "FOUND_" + row.agyReacher : "NOT_FOUND";
  return { ...counts, [key]: (counts[key] || 0) + 1 };
}, {});
console.log("agy:", tally);
