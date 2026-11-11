// Campaign 3 Cohort 4: moves the screened-out leads that are still real practices (med spas, cash-pay clinics,
// insurance practices, pediatric and kids therapy, urgent care, compounding pharmacies) into C3_COHORT_4 with
// their segment, case study, Clodo-looked-up email and ZeroBounce result. Input: artifacts/campaign-3-leads/
// cohort4-plan.json (segment and story per record) and lookup-cohort4-emails.json. Dry run by default.
// Usage: node scripts/campaign3-cohort4-setup.mjs [--save]

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

const plan = JSON.parse(fs.readFileSync(path.join(DIR, "cohort4-plan.json"), "utf8"));
const lookups = JSON.parse(fs.readFileSync(path.join(DIR, "lookup-cohort4-emails.json"), "utf8"));
const zerobounce = JSON.parse(fs.readFileSync(path.join(DIR, "..", "zerobounce-cache.json"), "utf8"));
const verification = (email) => (!email ? "NOT_CHECKED" : ({ valid: "VALID", invalid: "INVALID", "catch-all": "CATCH_ALL" })[zerobounce[email]?.status] || (zerobounce[email] ? "UNKNOWN" : "NOT_CHECKED"));
const key = (url) => (url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const emailMatchesName = (email, name) => {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const [first = "", ...rest] = name.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/);
  return (first.length > 2 && local.includes(first)) || ((rest.at(-1) || "").length > 2 && local.includes(rest.at(-1)));
};

async function gql(query, variables) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.TWENTY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const updates = plan.map((lead) => {
  const email = (lead.email || lookups[key(lead.linkedinUrl)]?.email || "").toLowerCase() || null;
  const status = verification(email);
  return {
    id: lead.id,
    name: lead.name,
    data: {
      cohort: "C3_COHORT_4",
      segment: lead.segment,
      caseStudy: lead.story,
      fitStatus: "MAYBE",
      fitReason: `Cohort 4 (${lead.segment}): outside cash-pay functional medicine, pitched with the ${lead.story} case study.`,
      researchStatus: "NOT_STARTED",
      ...(email && !lead.email ? { email, emailSource: "CLODO_LOOKUP", emailType: emailMatchesName(email, lead.name) ? "PERSONAL" : "PRACTICE_INBOX" } : {}),
      emailVerification: status,
    },
  };
});

const count = (field) => updates.reduce((map, update) => ((map[update.data[field]] = (map[update.data[field]] || 0) + 1), map), {});
console.log(`${updates.length} leads`, count("segment"), count("emailVerification"));
if (!SAVE) {
  console.log("dry run; pass --save to write to Twenty");
  process.exit(0);
}
for (const update of updates) {
  await gql(`mutation($id: UUID!, $data: Campaign3PersonUpdateInput!) { updateCampaign3Person(id: $id, data: $data) { id } }`, { id: update.id, data: update.data });
}
console.log(`updated ${updates.length} people`);
