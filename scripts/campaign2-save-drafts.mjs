// Writes drafted Day 0 / 4 / 10 emails (email1-3) and the subject line onto each lead's Campaign 2 cohort copy record
// (Cohort 1 to 4). A record that already has an Email 1 is left alone unless --overwrite, so sent copy is never replaced.
// Drafter flags go into placeholders.draftFlags so they show next to the copy. Dry run unless --save.
// Usage: node scripts/campaign2-save-drafts.mjs <created.json> <drafts.json>... [--save] [--overwrite]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const [createdFile, ...draftFiles] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const SAVE = process.argv.includes("--save");
const OVERWRITE = process.argv.includes("--overwrite");
const COPY_RELATIONS = [["cohort1Copy", "CohortOne"], ["cohort2Copy", "CohortTwo"], ["cohort3Copy", "CohortThree"], ["cohort4Copy", "CohortFour"]];
const STAMP = new Date().toISOString().slice(0, 10);

async function gql(query, variables) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.TWENTY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 3000 * attempt)); continue; }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
    return json.data;
  }
  throw new Error("rate limited");
}

const personIdByIssue = new Map(JSON.parse(fs.readFileSync(createdFile, "utf8")).map((c) => [c.identifier, c.campaign2PersonId]));
const drafts = draftFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, "utf8")));
const tally = {};
for (const draft of drafts) {
  const personId = personIdByIssue.get(draft.issue);
  const { campaign2Person: person } = await gql(
    `query($id: UUID!) { campaign2Person(filter: { id: { eq: $id } }) { id ${COPY_RELATIONS.map(([relation]) => `${relation} { edges { node { id subjectLine email1 placeholders } } }`).join(" ")} } }`,
    { id: personId },
  );
  const [relation, typeName] = COPY_RELATIONS.find(([name]) => person?.[name]?.edges.length) ?? [];
  const copy = relation && person[relation].edges[0].node;
  if (copy?.email1 && !OVERWRITE) {
    tally.ALREADY_DRAFTED = (tally.ALREADY_DRAFTED || 0) + 1;
    continue;
  }
  if (!copy || !draft.email1 || !draft.email2 || !draft.email3) {
    tally.SKIPPED = (tally.SKIPPED || 0) + 1;
    console.log("skipped", draft.issue);
    continue;
  }
  const data = {
    subjectLine: draft.subjectLine,
    email1: draft.email1,
    email2: draft.email2,
    email3: draft.email3,
    placeholders: { ...(copy.placeholders || {}), draftedAt: STAMP, draftFlags: draft.flags || "" },
  };
  if (draft.subjectLine !== copy.subjectLine) tally.subjectChanged = (tally.subjectChanged || 0) + 1;
  if (SAVE) {
    await gql(`mutation($id: UUID!, $data: Campaign2${typeName}UpdateInput!) { updateCampaign2${typeName}(id: $id, data: $data) { id } }`, { id: copy.id, data });
  }
  tally.SAVED = (tally.SAVED || 0) + 1;
}
console.log(SAVE ? "saved" : "dry run", drafts.length, "drafts", tally);
