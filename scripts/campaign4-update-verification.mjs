// Campaign 4: writes Reacher (emailVerification) and ZeroBounce (zerobounceStatus) results onto existing
// campaign4People and marks a lead VERIFIED when ZeroBounce says valid, or catch-all on an address the org
// published. campaign4-save.mjs only creates records, so verification reruns land here. Dry run by default.
// Usage: node scripts/campaign4-update-verification.mjs [--save]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const ARTIFACTS = path.join(__dirname, "..", "artifacts");
const SAVE = process.argv.includes("--save");

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const reacher = readJson(path.join(ARTIFACTS, "reacher-cache.json"));
const zerobounce = readJson(path.join(ARTIFACTS, "zerobounce-cache.json"));

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

const people = [];
for (let after = null; ; ) {
  const data = await gql(
    `query($after: String) { campaign4People(first: 200, after: $after) { edges { node { id email emailType emailVerification zerobounceStatus researchStatus } } pageInfo { hasNextPage endCursor } } }`,
    { after },
  );
  people.push(...data.campaign4People.edges.map((edge) => edge.node));
  if (!data.campaign4People.pageInfo.hasNextPage) break;
  after = data.campaign4People.pageInfo.endCursor;
}

const zerobounceStatus = (entry) =>
  !entry ? "NOT_CHECKED" : ({ valid: "VALID", invalid: "INVALID", "catch-all": "CATCH_ALL", do_not_mail: "DO_NOT_MAIL" })[entry.status] || "UNKNOWN";

const updates = [];
for (const person of people.filter((candidate) => candidate.email)) {
  const email = person.email.toLowerCase();
  const next = {
    emailVerification: reacher[email] ? reacher[email].result.toUpperCase() : "NOT_CHECKED",
    zerobounceStatus: zerobounceStatus(zerobounce[email]),
  };
  const sendable = next.zerobounceStatus === "VALID" || (next.zerobounceStatus === "CATCH_ALL" && person.emailType !== "GUESSED");
  if (person.researchStatus !== "NOT_A_FIT") next.researchStatus = sendable ? "VERIFIED" : person.researchStatus === "VERIFIED" ? "NOT_STARTED" : person.researchStatus;
  const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => person[key] !== value));
  if (Object.keys(changed).length) updates.push({ id: person.id, email, data: changed });
}

const count = (key) => people.reduce((map, person) => {
  const update = updates.find((candidate) => candidate.id === person.id);
  const value = update?.data[key] ?? person[key];
  map[value] = (map[value] || 0) + 1;
  return map;
}, {});
console.log(`${people.length} people, ${updates.length} to update`);
console.log("emailVerification (Reacher)", count("emailVerification"));
console.log("zerobounceStatus", count("zerobounceStatus"));
console.log("researchStatus", count("researchStatus"));

if (!SAVE) {
  console.log("dry run; pass --save to write to Twenty");
  process.exit(0);
}
for (const update of updates) {
  await gql(`mutation($id: UUID!, $data: Campaign4PersonUpdateInput!) { updateCampaign4Person(id: $id, data: $data) { id } }`, update);
}
console.log(`updated ${updates.length} people`);
