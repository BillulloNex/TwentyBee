// Campaign 4: checks every email from the Clubhouse directory and the research output with the
// self-hosted Reacher and caches results in artifacts/campaign-4-leads/emails-verified.json, so reruns
// only check new addresses. Reacher is throttled at 60 requests a minute.
// Usage: node scripts/campaign4-verify-emails.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const REACHER_URL = process.env.REACHER_URL || "http://reacher.beenex.org";
const DIR = path.join(__dirname, "..", "artifacts", "campaign-4-leads");
const CACHE_FILE = path.join(DIR, "emails-verified.json");

const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};
const orgs = JSON.parse(fs.readFileSync(path.join(DIR, "orgs-990.json"), "utf8"));
const researchDir = path.join(DIR, "research");
const research = fs.existsSync(researchDir)
  ? fs
      .readdirSync(researchDir)
      .filter((file) => /^output-\d+\.json$/.test(file))
      .flatMap((file) => JSON.parse(fs.readFileSync(path.join(researchDir, file), "utf8")))
  : [];

const emails = new Set([
  ...orgs.map((org) => org.directorEmail),
  ...research.flatMap((record) => (record.people || []).map((person) => person.email)),
].filter(Boolean).map((email) => email.toLowerCase().trim()).filter((email) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)));
const pending = [...emails].filter((email) => !cache[email]);
console.log(`${emails.size} emails, ${pending.length} to check`);

async function check(email) {
  const res = await fetch(REACHER_URL + "/v0/check_email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-reacher-secret": process.env.REACHER_SECRET },
    body: JSON.stringify({ to_email: email }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Reacher ${res.status}`);
  const result = await res.json();
  const flags = [];
  if (result.smtp?.is_catch_all) flags.push("catch_all");
  if (result.misc?.is_role_account) flags.push("role_account");
  if (result.smtp?.is_disabled) flags.push("disabled");
  if (result.smtp?.has_full_inbox) flags.push("full_inbox");
  if (!result.mx?.accepts_mail) flags.push("no_mx");
  return { result: result.is_reachable, detail: flags.join(","), checkedAt: new Date().toISOString() };
}

let done = 0;
const queue = [...pending];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const email = queue.shift();
      const started = Date.now();
      try {
        cache[email] = await check(email);
      } catch (error) {
        console.log(`${email}: ${error.message}`);
      }
      if (++done % 20 === 0) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log(`${done}/${pending.length}`);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 4000 - (Date.now() - started))));
    }
  }),
);
fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
const counts = Object.values(cache).reduce((map, entry) => ((map[entry.result] = (map[entry.result] || 0) + 1), map), {});
console.log("results", counts);
