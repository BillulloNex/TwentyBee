// Copies finished research-runner results into Twenty: comment1 -> researchSummary, comment2 -> socialSignals and
// every cited URL -> sourceLinks on the lead's cohort copy record, plus a note on the campaign2Person. The text is
// labelled UNVERIFIED and researchStatus stays IN_RESEARCH; subjectLine is left empty so nothing can be sent from it.
// Copy fields that already hold verified research are never overwritten. Dry run unless --save.
// Usage: node scripts/campaign2-sync-research.mjs [--save] [--resync]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const RUNS_DIR = path.join(__dirname, "..", "artifacts", "campaign-2-leads", "research-runs");
const SAVE = process.argv.includes("--save");
const RESYNC = process.argv.includes("--resync");
const UNVERIFIED_PREFIX = "UNVERIFIED";

const TOOL_LABELS = {
  gemini: "Gemini 3.8 Flash High via Antigravity",
  opus: "Claude Opus 4.6 via Antigravity",
  sonnet: "Claude Sonnet 4.6 via Antigravity",
  codex: "Codex",
};

const COPY_BY_COHORT = {
  C2_COHORT_1: { relation: "cohort1Copy", object: "Campaign2CohortOne" },
  C2_COHORT_2: { relation: "cohort2Copy", object: "Campaign2CohortTwo" },
  C2_COHORT_3: { relation: "cohort3Copy", object: "Campaign2CohortThree" },
  C2_COHORT_4: { relation: "cohort4Copy", object: "Campaign2CohortFour" },
};

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
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
    return json.data;
  }
  throw new Error("rate limited");
}

function citedUrls(...texts) {
  const urls = texts.join("\n").match(/https?:\/\/[^\s)\]>"'`,]+/g) ?? [];
  return [...new Set(urls.map((url) => url.replace(/[.;:]+$/, "")))];
}

const files = fs.readdirSync(RUNS_DIR).filter((file) => /^BEE-\d+\.json$/.test(file));
const tally = {};
const count = (key) => (tally[key] = (tally[key] || 0) + 1);

for (const file of files) {
  const filePath = path.join(RUNS_DIR, file);
  const result = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (result.error) { count("skipped: run failed"); continue; }
  if (result.syncedAt && !RESYNC) { count("skipped: already synced"); continue; }

  const { campaign2People } = await gql(
    `query($id: UUID!) { campaign2People(filter: { id: { eq: $id } }) { edges { node { id notes cohort researchStatus
      ${Object.values(COPY_BY_COHORT).map((copy) => `${copy.relation} { edges { node { id researchSummary } } }`).join(" ")} } } } }`,
    { id: result.campaign2PersonId },
  );
  const person = campaign2People.edges[0]?.node;
  if (!person) { count("skipped: person not found"); console.log(result.issue, "person not found"); continue; }
  const copyTarget = COPY_BY_COHORT[person.cohort];
  const copy = person[copyTarget.relation].edges[0]?.node;
  if (!copy) { count("skipped: no copy record"); console.log(result.issue, "no cohort copy record"); continue; }
  if (person.researchStatus !== "IN_RESEARCH" || (copy.researchSummary && !copy.researchSummary.startsWith(UNVERIFIED_PREFIX))) {
    count("skipped: already verified");
    continue;
  }

  const date = result.finishedAt.slice(0, 10);
  const header = `${UNVERIFIED_PREFIX} research by ${TOOL_LABELS[result.tool] ?? result.tool}, ${date} (Linear ${result.issue}). Not checked yet; do not write outreach from it.\n\n`;
  const copyData = {
    researchSummary: header + result.comment1,
    socialSignals: header + result.comment2,
    sourceLinks: citedUrls(result.comment1, result.comment2).join("\n"),
  };
  const note = `[${date}] Unverified research for ${result.issue} by ${TOOL_LABELS[result.tool] ?? result.tool} saved on the cohort copy record; verification pending.`;
  const notes = person.notes?.includes(note) ? person.notes : [person.notes, note].filter(Boolean).join(" ");

  count(`${SAVE ? "saved" : "would save"}: ${result.tool}`);
  if (!SAVE) continue;
  await gql(`mutation($id: UUID!, $data: ${copyTarget.object}UpdateInput!) { update${copyTarget.object}(id: $id, data: $data) { id } }`, { id: copy.id, data: copyData });
  await gql(`mutation($id: UUID!, $data: Campaign2PersonUpdateInput!) { updateCampaign2Person(id: $id, data: $data) { id } }`, { id: person.id, data: { notes } });
  fs.writeFileSync(filePath, JSON.stringify({ ...result, syncedAt: new Date().toISOString() }, null, 1));
}
console.log(new Date().toISOString(), SAVE ? "saved" : "dry run", files.length, "result files", tally);
