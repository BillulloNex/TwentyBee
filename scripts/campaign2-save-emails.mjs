// Writes emails found by campaign2-email-finder.mjs onto campaign1People records.
// Saves published addresses Reacher rated safe or risky (catch-all / role inboxes), plus guessed or agy-found
// addresses that cleared their own checks (guesses must be Reacher safe); invalid and unknown stay out.
// Skips any record that gained an email since the finder ran. Dry run unless --save.
// Usage: node scripts/campaign2-save-emails.mjs artifacts/campaign-2-leads/email-finder-<date>.json [--save]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const API_KEY = process.env.TWENTY_API_KEY;
const [inputFile] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const SAVE = process.argv.includes("--save");

async function gql(query, variables) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error("Twenty rate limit");
}

const { rows } = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const OK = ["safe", "risky"];
function pick(row) {
  if (row.email && row.mx && OK.includes(row.reacherResult)) {
    return { email: row.email, status: "UNKNOWN", source: `${row.emailKind} published on ${row.foundOn}; Reacher ${row.reacherResult}${row.reacherDetail ? " (" + row.reacherDetail + ")" : ""}` };
  }
  if (row.guessedEmail) {
    return { email: row.guessedEmail, status: "PATTERN_DERIVED", source: `pattern guess on ${row.host}; Reacher safe` };
  }
  if (row.agyEmail && OK.includes(row.agyReacher)) {
    return { email: row.agyEmail, status: "UNKNOWN", source: `web lookup, published on ${row.agySourceUrl}; Reacher ${row.agyReacher}${row.agyReacherDetail ? " (" + row.agyReacherDetail + ")" : ""}` };
  }
  return null;
}
// Academic addresses belong to faculty roles, not the practice owner we are trying to reach.
const toSave = rows.filter((row) => row.id && pick(row) && !/\.edu$/i.test(pick(row).email));
const stamp = path.basename(inputFile).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
const ledger = [];

for (const row of toSave) {
  const { campaign1Person: current } = await gql(
    `query($id: UUID!) { campaign1Person(filter: { id: { eq: $id } }) { id email cohort } }`,
    { id: row.id },
  );
  const chosen = pick(row);
  if (!current || current.email || current.cohort) {
    ledger.push({ id: row.id, name: row.name, email: chosen.email, status: "SKIPPED_CHANGED" });
    continue;
  }
  const data = { email: chosen.email, emailSource: `Campaign 2 finder ${stamp}: ${chosen.source}`, emailStatus: chosen.status };
  if (SAVE) {
    await gql(`mutation($id: UUID!, $data: Campaign1PersonUpdateInput!) { updateCampaign1Person(id: $id, data: $data) { id email } }`, { id: row.id, data });
  }
  ledger.push({ id: row.id, name: row.name, email: chosen.email, status: SAVE ? "SAVED" : "WOULD_SAVE" });
}

const runStamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
const ledgerFile = inputFile.replace(/\.json$/, `-${SAVE ? "saved" : "dry-run"}-ledger-${runStamp}.json`);
fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
const counts = ledger.reduce((tally, entry) => ({ ...tally, [entry.status]: (tally[entry.status] || 0) + 1 }), {});
console.log(counts, "ledger:", ledgerFile);
