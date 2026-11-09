// Runs each found email through the self-hosted Reacher (reacher.beenex.org) and stores the verdict
// on the finder rows as reacherResult / reacherDetail, in place.
// Usage: node scripts/campaign2-verify-emails.mjs artifacts/campaign-2-leads/email-finder-<date>.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const REACHER_URL = process.env.REACHER_URL || "http://reacher.beenex.org";
const REACHER_SECRET = process.env.REACHER_SECRET;
const [inputFile] = process.argv.slice(2);
// The backend throttles at 60 checks a minute.
const CONCURRENCY = 3;

async function checkEmail(email) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(REACHER_URL + "/v0/check_email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-reacher-secret": REACHER_SECRET },
        body: JSON.stringify({ to_email: email }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 20000 * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const result = await res.json();
      const smtp = result.smtp ?? {};
      const flags = [
        smtp.is_catch_all && "catch-all",
        result.misc?.is_role_account && "role",
        smtp.has_full_inbox && "full-inbox",
        smtp.is_disabled && "disabled",
        smtp.error && "smtp-error",
      ].filter(Boolean);
      return { reacherResult: result.is_reachable, reacherDetail: flags.join(",") };
    } catch (error) {
      if (attempt === 3) return { reacherResult: "error", reacherDetail: String(error.message).slice(0, 120) };
    }
  }
  return { reacherResult: "error", reacherDetail: "rate limited" };
}

const report = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const pending = report.rows.filter((row) => row.email && !row.reacherResult);
let next = 0;
let done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < pending.length) {
    const row = pending[next++];
    Object.assign(row, await checkEmail(row.email));
    if (++done % 20 === 0) {
      console.log(`  ${done}/${pending.length}`);
      fs.writeFileSync(inputFile, JSON.stringify(report, null, 1));
    }
  }
}));
fs.writeFileSync(inputFile, JSON.stringify(report, null, 1));

const tally = report.rows.filter((row) => row.email).reduce((counts, row) => {
  counts[row.reacherResult] = (counts[row.reacherResult] || 0) + 1;
  return counts;
}, {});
console.log("Reacher:", tally);
