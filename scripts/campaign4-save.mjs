// Campaign 4: writes organizations and decision makers to Twenty (campaign4Organizations / campaign4People)
// from the directory scrape, the IRS match, the research agents' output and Reacher results.
// Idempotent: orgs are matched by domain (or name + state when there is no site), people by email or
// name within the org. Dry run by default.
// Usage: node scripts/campaign4-save.mjs [--save]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const DIR = path.join(__dirname, "..", "artifacts", "campaign-4-leads");
const SAVE = process.argv.includes("--save");
const SOCIAL_HOSTS = /facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|linktr\.ee/i;
// MHA of the Palm Beaches bought at about $1M revenue; below this a ~$25k project is unlikely.
const MIN_REVENUE = 500_000;

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);

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

async function fetchAll(plural, fields) {
  const records = [];
  let after = null;
  for (;;) {
    const data = await gql(`query($after: String) { ${plural}(first: 200, after: $after) { edges { node { ${fields} } } pageInfo { hasNextPage endCursor } } }`, { after });
    records.push(...data[plural].edges.map((edge) => edge.node));
    if (!data[plural].pageInfo.hasNextPage) return records;
    after = data[plural].pageInfo.endCursor;
  }
}

const budgetWave = (month) => (month === 12 ? "JANUARY_FY" : month === 6 ? "JULY_FY" : month ? "OTHER_FY" : "UNKNOWN");
const sizeTier = (revenue) =>
  revenue == null ? "UNKNOWN" : revenue < 500_000 ? "UNDER_500K" : revenue < 1_000_000 ? "FROM_500K_TO_1M" : revenue < 5_000_000 ? "FROM_1M_TO_5M" : "OVER_5M";
const emailMatchesName = (email, name) => {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const [first = "", ...rest] = name.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/);
  const last = rest.at(-1) || "";
  return (first.length > 2 && local.includes(first)) || (last.length > 2 && local.includes(last)) || local === first[0] + last;
};

const orgs = readJson(path.join(DIR, "orgs-990.json"), []);
const research = fs
  .readdirSync(path.join(DIR, "research"))
  .filter((file) => /^output-\d+\.json$/.test(file))
  .flatMap((file) => readJson(path.join(DIR, "research", file), []));
const researchByDomain = new Map(research.map((record) => [record.domain, record]));
const verification = readJson(path.join(DIR, "emails-verified.json"), {});

const groups = new Map();
for (const org of orgs) {
  const domain = org.domain && !SOCIAL_HOSTS.test(org.domain) ? org.domain : null;
  const key = domain || `${org.name}|${org.state}`;
  if (!groups.has(key)) groups.set(key, { key, domain, listings: [] });
  groups.get(key).listings.push(org);
}

const plannedOrgs = [];
for (const group of groups.values()) {
  const found = group.domain ? researchByDomain.get(group.domain) : null;
  const sources = new Set(group.listings.map((listing) => listing.source));
  const first = group.listings.find((listing) => listing.source === "MHA_AFFILIATE") || group.listings[0];
  const irsListing = group.listings.find((listing) => listing.irsMatch === "HIGH") || group.listings.find((listing) => listing.irsMatch === "MEDIUM");
  const irsConfirmed = irsListing && (found ? found.irsMatchCorrect === true : irsListing.irsMatch === "HIGH");
  const irs = irsConfirmed ? irsListing : null;
  let fitStatus = "NOT_REVIEWED";
  if (found?.orgType === "GOVERNMENT") fitStatus = "GOVERNMENT";
  else if (found?.fit === "NOT_A_FIT") fitStatus = "NOT_A_FIT";
  else if (irs && irs.revenue != null && irs.revenue < MIN_REVENUE) fitStatus = "TOO_SMALL";
  else if (found?.fit === "FIT") fitStatus = "FIT";
  const summaryParts = found
    ? [
        found.summary,
        found.programs?.length ? `Programs: ${found.programs.join(", ")}.` : "",
        found.documentationSignals ? `Documentation signals: ${found.documentationSignals}` : "",
        `Fit (${found.fit}): ${found.fitReason}`,
        found.irsNote ? `IRS: ${found.irsNote}` : "",
      ]
    : [];
  const org = {
    name: found?.orgName || first.name,
    legalName: irs?.legalName || null,
    source: sources.size > 1 ? "BOTH" : [...sources][0],
    clubhouses: group.listings.filter((listing) => listing.source === "CLUBHOUSE").map((listing) => listing.name).join(", ") || null,
    website: first.websiteResolved || first.website || null,
    domain: group.domain,
    city: first.city,
    state: first.state,
    ein: irs?.ein || null,
    nteeCode: irs?.nteeCode || null,
    revenue: irs?.revenue ?? null,
    latestFilingYear: irs?.latestFilingYear ?? null,
    officerCompensation: irs?.officerCompensation ?? null,
    fiscalYearEndMonth: irs?.fiscalYearEndMonth ?? null,
    budgetWave: budgetWave(irs?.fiscalYearEndMonth),
    sizeTier: sizeTier(irs?.revenue),
    irsMatch: irs ? irsListing.irsMatch : "NONE",
    fitStatus,
    propublicaUrl: irs?.propublicaUrl || null,
    directoryUrl: group.listings.map((listing) => listing.directoryUrl).filter(Boolean).join("\n") || null,
    about: first.about || null,
    publishedEmails: found ? null : null,
    researchSummary: summaryParts.filter(Boolean).join("\n\n") || null,
  };

  const people = [];
  const addPerson = (person, evidence) => {
    if (!person.name || people.some((existing) => existing.name.toLowerCase() === person.name.toLowerCase())) return;
    const email = person.email ? person.email.toLowerCase() : null;
    const checked = email ? verification[email] : null;
    people.push({
      name: person.name,
      jobTitle: person.title || null,
      roleType: person.roleType || "OTHER",
      email,
      emailType: email ? (emailMatchesName(email, person.name) ? "PERSONAL" : "ORG_INBOX") : null,
      emailVerification: email ? (checked ? checked.result.toUpperCase() : "NOT_CHECKED") : null,
      emailSource: evidence || null,
      sourceUrl: person.sourceUrl || null,
      companyName: org.name,
      researchStatus: email && checked && ["safe", "risky"].includes(checked.result) ? "VERIFIED" : "NOT_STARTED",
      sequenceStage: "NOT_STARTED",
      nextAction: "NONE",
      emailsSent: 0,
    });
  };
  for (const person of found?.people || []) addPerson(person, person.emailEvidence);
  for (const listing of group.listings) {
    if (listing.directorName) {
      addPerson(
        { name: listing.directorName, title: `Director, ${listing.name}`, roleType: "CLUBHOUSE_DIRECTOR", email: listing.directorEmail, sourceUrl: listing.directoryUrl },
        "Clubhouse International directory",
      );
    }
  }
  if (found) org.publishedEmails = (readJson(path.join(DIR, "org-pages.json"), []).find((site) => site.domain === group.domain)?.emails || []).join(", ") || null;
  plannedOrgs.push({ org, people });
}

const count = (items, key) => items.reduce((map, item) => ((map[item[key]] = (map[item[key]] || 0) + 1), map), {});
const allPeople = plannedOrgs.flatMap((planned) => planned.people);
console.log(`orgs: ${plannedOrgs.length}`, count(plannedOrgs.map((planned) => planned.org), "fitStatus"));
console.log(`people: ${allPeople.length}, with email ${allPeople.filter((person) => person.email).length}`, count(allPeople, "emailVerification"));

if (!SAVE) {
  fs.writeFileSync(path.join(DIR, "save-plan.json"), JSON.stringify(plannedOrgs, null, 2));
  console.log("dry run; plan written to artifacts/campaign-4-leads/save-plan.json (pass --save to write to Twenty)");
  process.exit(0);
}

const existingOrgs = await fetchAll("campaign4Organizations", "id name domain state");
const existingPeople = await fetchAll("campaign4People", "id name email organizationId");
let createdOrgs = 0;
let createdPeople = 0;
for (const { org, people } of plannedOrgs) {
  let orgId = existingOrgs.find((existing) => (org.domain ? existing.domain === org.domain : existing.name === org.name && existing.state === org.state))?.id;
  if (!orgId) {
    const data = await gql(`mutation($data: Campaign4OrganizationCreateInput!) { createCampaign4Organization(data: $data) { id } }`, { data: org });
    orgId = data.createCampaign4Organization.id;
    createdOrgs++;
  }
  for (const person of people) {
    const exists = existingPeople.some(
      (existing) => (person.email && existing.email === person.email) || (existing.organizationId === orgId && existing.name.toLowerCase() === person.name.toLowerCase()),
    );
    if (exists) continue;
    const data = Object.fromEntries(Object.entries({ ...person, organizationId: orgId }).filter(([, value]) => value !== null));
    await gql(`mutation($data: Campaign4PersonCreateInput!) { createCampaign4Person(data: $data) { id } }`, { data });
    createdPeople++;
  }
}
console.log(`created ${createdOrgs} orgs and ${createdPeople} people`);
