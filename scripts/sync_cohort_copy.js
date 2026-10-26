// Write approved email copy from a local override file into Twenty cohort records, then read it back.
// Usage: node scripts/sync_cohort_copy.js --field day10Email --copy-file <json> [--object campaign1CohortOnes]
// The JSON maps recipient email -> body text. Records are matched on placeholders.email.

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const TWENTY_API_TOKEN = process.env.TWENTY_API_KEY;
const TWENTY_API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud").replace(/\/$/, "") + "/graphql";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const FIELD = flag("--field");
const COPY_FILE = flag("--copy-file");
const OBJECT = flag("--object") || "campaign1CohortOnes";
const SINGULAR = { campaign1CohortOnes: "Campaign1CohortOne", campaign1CohortPilots: "Campaign1CohortPilot" }[OBJECT];
if (!FIELD || !COPY_FILE || !SINGULAR) {
  console.error("Need --field <day0Email|day4Email|day10Email> --copy-file <json> [--object campaign1CohortOnes|campaign1CohortPilots]");
  process.exit(1);
}

async function twenty(query, variables) {
  const res = await fetch(TWENTY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TWENTY_API_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function main() {
  const copy = JSON.parse(fs.readFileSync(COPY_FILE, "utf8"));
  const data = await twenty(`query { ${OBJECT}(first: 200) { edges { node { id name placeholders ${FIELD} } } } }`);
  const records = data[OBJECT].edges.map((e) => e.node);
  const byEmail = new Map(records.map((r) => [(r.placeholders?.email || "").toLowerCase(), r]));

  const results = [];
  for (const [email, body] of Object.entries(copy)) {
    const rec = byEmail.get(email.toLowerCase());
    if (!rec) {
      results.push({ email, status: "NO_RECORD" });
      continue;
    }
    const before = rec[FIELD] || "";
    await twenty(
      `mutation Update($id: ID!, $data: ${SINGULAR}UpdateInput!) { update${SINGULAR}(id: $id, data: $data) { id } }`,
      { id: rec.id, data: { [FIELD]: body } },
    );
    const back = await twenty(`query($id: UUID!) { ${OBJECT}(filter: { id: { eq: $id } }, first: 1) { edges { node { id ${FIELD} } } } }`, { id: rec.id });
    const after = back[OBJECT].edges[0]?.node?.[FIELD] || "";
    results.push({ email, name: rec.name, id: rec.id, status: after === body ? "MATCH" : "MISMATCH", changed: before !== after, beforeLength: before.length, afterLength: after.length });
  }
  for (const r of results) console.log(`${r.status.padEnd(9)} ${r.email}${r.name ? `  (${r.name}, ${r.id})` : ""}${r.changed === false ? "  [unchanged]" : ""}`);
  const bad = results.filter((r) => r.status !== "MATCH");
  console.log(`\n${results.length - bad.length}/${results.length} records match the approved copy.`);
  if (bad.length) process.exit(2);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
