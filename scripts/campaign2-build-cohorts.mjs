// Builds Campaign 2: takes every campaign1People record that got a Campaign 2 email (minus CLOSED),
// keeps one person per email address, splits them into 4 equal cohorts balanced on email type and
// confidence, and creates campaign2People + one linked record per person in its cohort object.
// Dry run unless --save. Usage: node scripts/campaign2-build-cohorts.mjs [--save]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const SAVE = process.argv.includes("--save");
const OUT_DIR = path.join(__dirname, "..", "artifacts", "campaign-2-leads");
const COHORTS = ["C2_COHORT_1", "C2_COHORT_2", "C2_COHORT_3", "C2_COHORT_4"];
const COHORT_OBJECT = { C2_COHORT_1: "campaign2CohortOnes", C2_COHORT_2: "campaign2CohortTwos", C2_COHORT_3: "campaign2CohortThrees", C2_COHORT_4: "campaign2CohortFours" };
const COHORT_CREATE = { C2_COHORT_1: "createCampaign2CohortOnes", C2_COHORT_2: "createCampaign2CohortTwos", C2_COHORT_3: "createCampaign2CohortThrees", C2_COHORT_4: "createCampaign2CohortFours" };
const FREEMAIL = /@(gmail|yahoo|outlook|hotmail|aol|icloud|comcast|msn|live|me)\./i;
const ROLE_INBOX = /^(info|office|contact|hello|admin|team|support|frontdesk|front|appointments?|scheduling|patients?|patientinfo|reception|care|wellness|clinic|help|enrollment|member|billing|ask|getintouch)\b/i;

async function gql(query, variables) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.TWENTY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 3000 * attempt)); continue; }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 500));
    return json.data;
  }
  throw new Error("rate limited");
}

async function fetchAll(objectName, fields, filter) {
  const records = [];
  let after = null;
  for (;;) {
    const data = await gql(`query($after: String, $filter: ${objectName[0].toUpperCase() + objectName.slice(1, -0)}FilterInput) { ${objectName}(first: 200, after: $after, filter: $filter) { pageInfo { hasNextPage endCursor } edges { node { ${fields} } } } }`.replace(/People|Practices|Companies/, (m) => m), { after, filter });
    const page = data[objectName];
    records.push(...page.edges.map((edge) => edge.node));
    if (!page.pageInfo.hasNextPage) return records;
    after = page.pageInfo.endCursor;
  }
}

// Seeded shuffle so the split is reproducible.
function shuffle(items, seed) {
  const result = [...items];
  let state = seed;
  const random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function nameTokens(name = "") {
  return name.toLowerCase().replace(/^dr\.?\s+/, "").replace(/,.*$/, "").split(/\s+/).map((t) => t.replace(/[^a-z]/g, "")).filter((t) => t.length > 2);
}

function emailType(person) {
  if (person.emailStatus === "PATTERN_DERIVED") return "GUESSED";
  const local = person.email.split("@")[0].toLowerCase();
  if (ROLE_INBOX.test(local)) return "PRACTICE_INBOX";
  if (/PERSONAL/.test(person.emailSource || "") || nameTokens(person.name).some((t) => local.includes(t))) return "PERSONAL";
  return "PRACTICE_INBOX";
}

function websiteOf(person) {
  if (!FREEMAIL.test(person.email)) return person.email.split("@")[1].toLowerCase();
  const url = (person.emailSource || "").match(/https?:\/\/([^/\s;]+)/);
  return url ? url[1].replace(/^www\./, "") : "";
}

const normalizeCompany = (name = "") => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

const people = await fetchAll(
  "campaign1People",
  "id name jobTitle companyName confidence email emailSource emailStatus sequenceStage notes verifiedFact",
  { emailSource: { ilike: "Campaign 2 finder%" } },
);
const [overture, pdl] = await Promise.all([
  fetchAll("overtureCashPayPractices", "name city state"),
  fetchAll("pdlCashPayCompanies", "name locality region"),
]);
const locationByCompany = new Map();
for (const p of overture) locationByCompany.set(normalizeCompany(p.name), [p.city, p.state].filter(Boolean).join(", "));
for (const p of pdl) if (!locationByCompany.has(normalizeCompany(p.name))) locationByCompany.set(normalizeCompany(p.name), [p.locality, p.region].filter(Boolean).join(", ").replace(/\b\w/g, (c) => c.toUpperCase()));

const junkNameIds = new Set(
  fs.readFileSync(path.join(OUT_DIR, "saved-records-needing-name-fix.csv"), "utf8").split("\n").slice(1).map((line) => line.split(",").pop()?.replace(/"/g, "").trim()).filter(Boolean),
);

const typeRank = { PERSONAL: 0, GUESSED: 1, PRACTICE_INBOX: 2 };
const confidenceRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const byEmail = new Map();
let closed = 0;
for (const person of people) {
  if (person.sequenceStage === "CLOSED") { closed++; continue; }
  const candidate = { ...person, email: person.email.toLowerCase(), type: emailType(person), junkName: junkNameIds.has(person.id) };
  const key = candidate.email;
  const current = byEmail.get(key);
  const score = (p) => [p.junkName ? 1 : 0, typeRank[p.type], confidenceRank[p.confidence] ?? 3];
  if (!current || score(candidate).join() < score(current).join()) byEmail.set(key, candidate);
}
const unique = [...byEmail.values()];

// Deal each email-type x confidence stratum round-robin, continuing the rotation across strata,
// so cohort sizes differ by at most one and each cohort gets the same mix.
const strata = new Map();
for (const person of unique) {
  const key = person.type + "|" + person.confidence;
  if (!strata.has(key)) strata.set(key, []);
  strata.get(key).push(person);
}
let turn = 0;
for (const key of [...strata.keys()].sort()) {
  for (const person of shuffle(strata.get(key), 20261101)) person.cohort = COHORTS[turn++ % 4];
}

const summary = {};
for (const person of unique) {
  summary[person.cohort] ??= { total: 0, PERSONAL: 0, GUESSED: 0, PRACTICE_INBOX: 0, HIGH: 0, MEDIUM: 0, junkName: 0 };
  const s = summary[person.cohort];
  s.total++; s[person.type]++; s[person.confidence]++; if (person.junkName) s.junkName++;
}
console.log(`campaign1People with Campaign 2 email: ${people.length}, closed: ${closed}, unique emails: ${unique.length}`);
console.table(summary);
const mollyann = unique.find((p) => p.id === "c4f1c436-4e65-4b92-ba98-fdab7cd8ae25");
console.log("Mollyann ->", mollyann?.cohort, "| Mackenzie ->", unique.find((p) => p.id === "fcca3bf4-4c8d-4dc2-b22c-107f89a3486a")?.cohort);

fs.writeFileSync(path.join(OUT_DIR, "campaign2-cohorts.json"), JSON.stringify(unique.map((p) => ({ id: p.id, name: p.name, companyName: p.companyName, email: p.email, type: p.type, confidence: p.confidence, cohort: p.cohort, junkName: p.junkName })), null, 1));
if (!SAVE) process.exit(0);

const existing = await fetchAll("campaign2People", "id campaign1PersonId");
const already = new Set(existing.map((p) => p.campaign1PersonId));
const toCreate = unique.filter((p) => !already.has(p.id));
console.log(`creating ${toCreate.length} (skipping ${unique.length - toCreate.length} already present)`);
for (let i = 0; i < toCreate.length; i += 50) {
  const batch = toCreate.slice(i, i + 50);
  const data = batch.map((p) => ({
    name: p.name,
    jobTitle: p.jobTitle || "",
    companyName: p.companyName || "",
    website: websiteOf(p),
    location: locationByCompany.get(normalizeCompany(p.companyName)) || "",
    email: p.email,
    emailSource: p.emailSource || "",
    emailType: p.type,
    confidence: p.confidence || null,
    cohort: p.cohort,
    researchStatus: "NOT_STARTED",
    verifiedFact: p.verifiedFact || "",
    notes: [p.junkName ? "[Name is scraped page text, fix before sending]" : "", p.notes || ""].filter(Boolean).join(" "),
    campaign1PersonId: p.id,
    sequenceStage: "NOT_STARTED",
    nextAction: "NONE",
    emailsSent: 0,
  }));
  const created = (await gql(`mutation($data: [Campaign2PersonCreateInput!]!) { createCampaign2People(data: $data) { id campaign1PersonId cohort name } }`, { data })).createCampaign2People;
  for (const cohort of COHORTS) {
    const rows = created.filter((c) => c.cohort === cohort).map((c) => ({ name: c.name, personId: c.id }));
    if (rows.length) await gql(`mutation($data: [${COHORT_OBJECT[cohort][0].toUpperCase() + COHORT_OBJECT[cohort].slice(1, -1)}CreateInput!]!) { ${COHORT_CREATE[cohort]}(data: $data) { id } }`, { data: rows });
  }
  console.log(`  ${Math.min(i + 50, toCreate.length)}/${toCreate.length}`);
}
