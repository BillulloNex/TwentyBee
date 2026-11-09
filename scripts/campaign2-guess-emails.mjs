// For finder rows with a live site but no published email, tries common address patterns on the
// practice domain and keeps one only when Reacher says "safe". Catch-all domains accept any address,
// so a guess there proves nothing and the domain is skipped after the first check.
// Writes guessedEmail / guessResult onto the rows in place.
// Usage: node scripts/campaign2-guess-emails.mjs artifacts/campaign-2-leads/email-finder-<stamp>-people.json

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
const CONCURRENCY = 3;

async function reacher(email) {
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
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } catch {
      if (attempt === 3) return null;
    }
  }
  return null;
}

function nameParts(name) {
  const tokens = name.toLowerCase().replace(/^dr\.?\s+/, "").replace(/,.*$/, "").split(/\s+/)
    .map((token) => token.replace(/[^a-z]/g, ""))
    .filter((token) => token.length > 1 && !["md", "do", "nd", "dc", "np", "fnp", "lac", "phd", "dnp"].includes(token));
  return tokens.length >= 2 ? { first: tokens[0], last: tokens[tokens.length - 1] } : null;
}

function patterns({ first, last }, domain) {
  return [`${first}@`, `${first}.${last}@`, `${first[0]}${last}@`, `dr${last}@`, `${first}${last}@`, `dr.${last}@`].map((local) => local + domain);
}

async function guess(row) {
  const parts = nameParts(row.name || "");
  if (!parts) return { guessResult: "NO_NAME" };
  const domain = row.host;
  for (const email of patterns(parts, domain)) {
    const result = await reacher(email);
    if (!result) return { guessResult: "REACHER_ERROR" };
    if (result.smtp?.is_catch_all) return { guessResult: "CATCH_ALL" };
    if (!result.mx?.accepts_mail) return { guessResult: "NO_MX" };
    if (result.is_reachable === "safe") return { guessedEmail: email, guessResult: "SAFE" };
    if (result.is_reachable === "unknown") return { guessResult: "SMTP_UNKNOWN" };
  }
  return { guessResult: "NO_PATTERN_MATCHED" };
}

const report = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const pending = report.rows.filter((row) => row.siteReachable && !row.email && row.id && !row.guessResult);
console.log(`Guessing for ${pending.length} leads`);
let next = 0;
let done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < pending.length) {
    const row = pending[next++];
    Object.assign(row, await guess(row));
    if (++done % 20 === 0) {
      console.log(`  ${done}/${pending.length}`);
      fs.writeFileSync(inputFile, JSON.stringify(report, null, 1));
    }
  }
}));
fs.writeFileSync(inputFile, JSON.stringify(report, null, 1));
const tally = pending.reduce((counts, row) => ({ ...counts, [row.guessResult]: (counts[row.guessResult] || 0) + 1 }), {});
console.log("Guesses:", tally);
