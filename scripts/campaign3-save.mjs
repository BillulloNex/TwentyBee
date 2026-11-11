// Campaign 3: writes every new lead from the Clodo test into Twenty (campaign3People), with its cohort,
// email source, ZeroBounce result and screening data. Leads already in Campaign 1/2 or an earlier pull
// are skipped. Cohorts: C3_COHORT_1 = basic search + our own email finding, C3_COHORT_2 = Deep Search,
// C3_COHORT_3 = basic search + Clodo email lookup (1 and 3 are a random split of one pool).
// Idempotent (matched on LinkedIn URL, then name + domain). Dry run by default.
// Usage: node scripts/campaign3-save.mjs [--save]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const DIR = path.join(__dirname, "..", "artifacts", "campaign-3-leads");
const SAVE = process.argv.includes("--save");
const PEOPLE_JOBS = ["dj_702a676f29a047f48887125c667b55ca", "dj_ff17e2d8450a41b296ed00fbab9be06f", "dj_ec42dd20f28c4efea9d88e5934ceda36"];
const DEEP_JOB = "dj_887ad752383a4180b80a0999ee324f45";

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
const zerobounce = readJson(path.join(__dirname, "..", "artifacts", "zerobounce-cache.json"), {});
const verification = (email) => ({ valid: "VALID", invalid: "INVALID", "catch-all": "CATCH_ALL" })[zerobounce[(email || "").toLowerCase()]?.status] || (zerobounce[(email || "").toLowerCase()] ? "UNKNOWN" : "NOT_CHECKED");

// The screening rules used to build the test pool on 2026-11-11: clinic industries only, no insurance
// billing, no adjacent businesses the search drifted into (software, med spas, pediatrics, ...).
// People Search and Deep Search label industries differently ("Medical Practices" vs "medical practice").
const OK_INDUSTRY = /medical practice|wellness|fitness|alternative medicine|hospital|health care|mental health/i;
const OFF_TARGET = /pediatric|kids|urgent care|derma|skin doc|aesthetic|med ?spa|medspa|medical spa|laser|physical therap|\bpt\b|speech|audiology|gastro|pharmacy|compounding|coach|marketing|publishing|travel|recycling|software|\bapp\b|summit|web studio|clinicmind|practice marketplace|leading practice|capturemd|boundary|oxkair|osheru|florasophy|two moons|nextme|preamble|opaline|ratio|spinal|chiropract|hyperbaric|bilinguistics|learning group|breathe institute|lifesculpt|fresh faces|infusion care|psychedelic|cardiolog|bluebird|in & out|stat med|women over 70|own it|thinkbullish|fast track|vitality nexus|restore forward|rewind|wellset|runga|ayurveda|barton|eudemonia|ncx brain|recess therapy|pelvic|flex audi|biocytics|autumn behavioral|phallofill|norcal adhd/i;
const FIT = /functional|integrative|longevity|naturopath|holistic|regenerat|concierge|direct (primary )?care|\bdpc\b|wellness|optimal|vitality|healthspan|personaliz|preventive|precision|hormone|anti.?aging|biore|lifestyle medicine|primary care|health(?! system)/i;

function screen(item) {
  const lead = item.lead;
  const text = [lead.company?.name, lead.current_job_title, lead.company?.domain].join(" ");
  if (item.site?.payment === "INSURANCE") return { fitStatus: "NOT_A_FIT", fitReason: "site says it bills insurance" };
  if (lead.company?.industry && !OK_INDUSTRY.test(lead.company.industry)) return { fitStatus: "NOT_A_FIT", fitReason: `industry: ${lead.company?.industry || "unknown"}` };
  if (OFF_TARGET.test(text)) return { fitStatus: "NOT_A_FIT", fitReason: "adjacent business, not a cash-pay functional medicine clinic" };
  if (FIT.test(text) || (item.site?.caseStudy !== "GENERIC" && item.site?.payment === "CASH_PAY")) return { fitStatus: "FIT", fitReason: "functional / integrative / longevity / DPC clinic" };
  return { fitStatus: "MAYBE", fitReason: "clinic type unclear from name and title" };
}

const hostOf = (value) => (value || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
const keyOf = (lead) => lead.professional_url || lead.full_name;

const cohort1 = new Map(readJson(path.join(DIR, "pool-cohort1-own-finding.json"), []).map((entry) => [entry.key, entry]));
const cohort3 = new Map(readJson(path.join(DIR, "pool-cohort3-clodo-lookup.json"), []).map((entry) => [entry.key, entry]));
const ownEmails = new Map(readJson(path.join(DIR, "pool-cohort1-own-finding-own-emails.json"), []).map((entry) => [entry.key, entry]));
const lookups = { ...readJson(path.join(DIR, "lookup-batch-1-emails.json"), {}), ...readJson(path.join(DIR, "lookup-batch-2-emails.json"), {}) };

function baseRecord(item, jobId, leadSource) {
  const lead = item.lead;
  const domain = hostOf(lead.company?.domain);
  return {
    name: lead.full_name,
    jobTitle: lead.current_job_title || null,
    companyName: lead.company?.name || null,
    website: domain ? `https://${domain}` : null,
    domain: domain || null,
    location: lead.location || null,
    linkedinUrl: lead.professional_url ? (lead.professional_url.startsWith("http") ? lead.professional_url : `https://${lead.professional_url}`) : null,
    employeeCount: typeof lead.company?.employee_count === "number" ? lead.company.employee_count : null,
    industry: lead.company?.industry || null,
    leadSource,
    clodoJobId: jobId,
    clodoScore: typeof lead.score === "number" ? lead.score : null,
    paymentModel: item.site?.payment || (item.site?.reachable === false ? "UNKNOWN" : "UNKNOWN"),
    techStack: item.site?.stack?.length ? item.site.stack.join(", ") : null,
    caseStudy: item.site?.caseStudy && item.site.caseStudy !== "unreachable" ? item.site.caseStudy : "GENERIC",
    sequenceStage: "NOT_STARTED",
    nextAction: "NONE",
    emailsSent: 0,
  };
}

const records = [];
for (const jobId of PEOPLE_JOBS) {
  for (const item of readJson(path.join(DIR, `clodo-people-${jobId}-screen.json`), [])) {
    if (item.duplicate) continue;
    const record = { ...baseRecord(item, jobId, "CLODO_PEOPLE_SEARCH"), ...screen(item) };
    const key = keyOf(item.lead);
    const notes = [];
    if (cohort1.has(key)) {
      record.cohort = "C3_COHORT_1";
      const found = ownEmails.get(key) || {};
      const status = verification(found.email);
      if (found.email && status === "VALID" && ["GUESS_FIRST_NAME", "PUBLISHED_PERSONAL"].includes(found.method)) {
        record.email = found.email;
        record.emailSource = found.method === "PUBLISHED_PERSONAL" ? "SITE_PUBLISHED" : "PATTERN_GUESS";
        record.emailType = "PERSONAL";
        record.emailVerification = "VALID";
      } else if (found.email && found.method === "GUESS_FIRST_NAME") {
        notes.push(`First-name guess ${found.email} is ${status.toLowerCase()} (ZeroBounce).`);
      } else if (!found.email) {
        notes.push(`Own email search: ${(found.method || "not run").toLowerCase().replace(/_/g, " ")}.`);
      }
      const shared = found.method === "PUBLISHED_OTHER_PERSON" ? found.email : found.fallbackShared || (found.method === "PUBLISHED_SHARED" ? found.email : null);
      if (shared) record.backupEmail = shared;
    } else if (cohort3.has(key)) {
      record.cohort = "C3_COHORT_3";
      const found = lookups[key];
      if (found?.email) {
        record.email = found.email.toLowerCase();
        record.emailSource = "CLODO_LOOKUP";
        record.emailType = "PERSONAL";
        record.emailVerification = verification(found.email);
      } else {
        notes.push("Clodo email lookup found no address (charged 5 credits).");
      }
    } else if (record.fitStatus !== "NOT_A_FIT") {
      // Built into the pool by hand on 2026-11-11 and left out; keep the reason visible.
      record.fitStatus = "NOT_A_FIT";
      record.fitReason = "left out of the test pool on review";
    }
    record.researchStatus = record.fitStatus === "NOT_A_FIT" ? "NOT_A_FIT" : record.emailVerification === "VALID" ? "VERIFIED" : "NOT_STARTED";
    if (notes.length) record.notes = notes.join(" ");
    records.push(record);
  }
}
for (const item of readJson(path.join(DIR, `clodo-deep-${DEEP_JOB}-screen.json`), [])) {
  if (item.duplicate) continue;
  const record = { ...baseRecord(item, DEEP_JOB, "CLODO_DEEP_SEARCH"), ...screen(item) };
  if (record.fitStatus !== "NOT_A_FIT") record.cohort = "C3_COHORT_2";
  if (item.lead.email) {
    record.email = item.lead.email.toLowerCase();
    record.emailSource = "CLODO_DEEP_SEARCH";
    record.emailType = "PERSONAL";
    record.emailVerification = verification(item.lead.email);
  } else {
    record.notes = "Deep Search returned no email.";
  }
  record.researchStatus = record.fitStatus === "NOT_A_FIT" ? "NOT_A_FIT" : record.emailVerification === "VALID" ? "VERIFIED" : "NOT_STARTED";
  records.push(record);
}

const count = (key) => records.reduce((map, record) => ((map[record[key] ?? "none"] = (map[record[key] ?? "none"] || 0) + 1), map), {});
console.log(`records: ${records.length}`);
console.log("cohort", count("cohort"));
console.log("fit", count("fitStatus"));
console.log("verification", count("emailVerification"));
console.log("ready to send (verified, in a cohort)", records.filter((record) => record.cohort && record.emailVerification === "VALID").length);

if (!SAVE) {
  fs.writeFileSync(path.join(DIR, "save-plan.json"), JSON.stringify(records, null, 2));
  console.log("dry run; plan written to artifacts/campaign-3-leads/save-plan.json (pass --save to write to Twenty)");
  process.exit(0);
}

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

const existing = [];
let after = null;
for (;;) {
  const data = await gql(`query($after: String) { campaign3People(first: 200, after: $after) { edges { node { id name domain linkedinUrl } } pageInfo { hasNextPage endCursor } } }`, { after });
  existing.push(...data.campaign3People.edges.map((edge) => edge.node));
  if (!data.campaign3People.pageInfo.hasNextPage) break;
  after = data.campaign3People.pageInfo.endCursor;
}
let created = 0;
for (const record of records) {
  const exists = existing.some(
    (person) => (record.linkedinUrl && person.linkedinUrl === record.linkedinUrl) || (person.name === record.name && person.domain === record.domain),
  );
  if (exists) continue;
  const data = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined));
  await gql(`mutation($data: Campaign3PersonCreateInput!) { createCampaign3Person(data: $data) { id } }`, { data });
  created++;
}
console.log(`created ${created} campaign3People`);
