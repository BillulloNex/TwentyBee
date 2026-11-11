// Campaign 3: writes writer results (artifacts/campaign-3-leads/write-runs/results-*.json) onto campaign3People:
// subject line, the three emails, research summary, source links and reviewer flags, and researchStatus VERIFIED
// (or NOT_A_FIT). Nothing is queued to send; sequenceStage and nextAction are left alone. Records that already have
// email1 are skipped unless --overwrite. Dry run by default.
// Usage: node scripts/campaign3-save-drafts.mjs [--save] [--overwrite]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const LEADS_DIR = path.join(__dirname, "..", "artifacts", "campaign-3-leads");
const SAVE = process.argv.includes("--save");
const OVERWRITE = process.argv.includes("--overwrite");

async function gql(query, variables) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.TWENTY_API_KEY, "Content-Type": "application/json" },
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

const writeDir = path.join(LEADS_DIR, "write-runs");
const results = new Map();
for (const file of fs.readdirSync(writeDir).filter((name) => /^results-.*\.json$/.test(name)).sort()) {
  for (const result of JSON.parse(fs.readFileSync(path.join(writeDir, file), "utf8"))) results.set(result.key, result);
}

const personIdFor = (key) => JSON.parse(fs.readFileSync(path.join(LEADS_DIR, "gather-runs", key + ".json"), "utf8")).campaign3PersonId;
const existing = new Map(
  (await gql(`{ campaign3People(first: 300, filter: { cohort: { is: NOT_NULL } }) { edges { node { id email1 } } } }`)).campaign3People.edges.map(({ node }) => [node.id, node]),
);

const updates = [];
for (const [key, result] of results) {
  const id = personIdFor(key);
  if (!existing.has(id)) {
    console.log(`${key}: no campaign3Person ${id}`);
    continue;
  }
  if (existing.get(id).email1 && !OVERWRITE) continue;
  const failed = result.verdict === "FAIL" || result.fit === "NOT_A_FIT";
  const subjectSource = result.subjectSource ? `Subject from ${result.subjectSource.source} (${result.subjectSource.platform}): "${result.subjectSource.quote}" ${result.subjectSource.url}` : "";
  updates.push({
    key,
    id,
    data: {
      researchStatus: result.fit === "NOT_A_FIT" ? "NOT_A_FIT" : failed ? "IN_RESEARCH" : "VERIFIED",
      subjectLine: failed ? null : result.subjectLine,
      email1: failed ? null : result.email1,
      email2: failed ? null : result.email2,
      email3: failed ? null : result.email3,
      researchSummary: [result.researchSummary, subjectSource].filter(Boolean).join("\n\n"),
      sourceLinks: result.sourceLinks || null,
      draftFlags: [`${result.verdict} / ${result.fit} / peer ${result.peerStory || "-"}`, result.flags].filter(Boolean).join(": "),
    },
  });
}

const count = (key) => updates.reduce((map, update) => ((map[update.data[key]] = (map[update.data[key]] || 0) + 1), map), {});
console.log(`${results.size} results, ${updates.length} to write`, count("researchStatus"));
if (!SAVE) {
  for (const update of updates.slice(0, 3)) console.log(`\n${update.key} | ${update.data.subjectLine}\n${update.data.email1}`);
  console.log("\ndry run; pass --save to write to Twenty");
  process.exit(0);
}
for (const update of updates) {
  await gql(`mutation($id: UUID!, $data: Campaign3PersonUpdateInput!) { updateCampaign3Person(id: $id, data: $data) { id } }`, { id: update.id, data: update.data });
}
console.log(`updated ${updates.length} people`);
