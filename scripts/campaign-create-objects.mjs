// Campaign object schemas in Twenty. Campaign 3: campaign3Person (Clodo-sourced clinic leads with the
// source, verification and screening data of the test). Campaign 4: campaign4Organization (one per
// nonprofit, with 990 data) and campaign4Person. People carry the same sequence fields as
// campaign2Person so the daily sender can pick them up later. Idempotent: existing objects and fields
// are left alone. Metadata is created one call at a time because parallel creates time out on the
// workspace schema rebuild.
// Usage: node scripts/campaign-create-objects.mjs --campaign 3|4 [--dry-run]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const METADATA_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/metadata";
const DRY_RUN = process.argv.includes("--dry-run");
const CAMPAIGN = process.argv.includes("--campaign") ? process.argv[process.argv.indexOf("--campaign") + 1] : null;
const COLORS = ["gray", "blue", "green", "orange", "purple", "red", "sky", "turquoise", "yellow", "pink"];

const select = (values) => ({
  type: "SELECT",
  options: values.map((value, position) => ({
    value,
    label: value.toLowerCase().replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase()),
    color: COLORS[position % COLORS.length],
    position,
  })),
});
const text = { type: "TEXT" };
const number = { type: "NUMBER" };

const SEQUENCE_FIELDS = {
  sequenceStage: select(["NOT_STARTED", "READY", "SEQ1_SENT", "SEQ2_SENT", "SEQ3_SENT", "REPLIED", "BOOKED", "OPTED_OUT", "BOUNCED", "WRONG_PERSON", "PAUSED_OOO", "CLOSED"]),
  nextAction: select(["SEND_SEQ1", "SEND_SEQ2", "SEND_SEQ3", "LI_INVITE", "NONE"]),
  nextActionDue: { type: "DATE_TIME" },
  lastSentFrom: text,
  lastMessageId: text,
  emailsSent: number,
};

const CAMPAIGN_3 = [
  {
    nameSingular: "campaign3Person",
    namePlural: "campaign3People",
    labelSingular: "C3 Person",
    labelPlural: "C3 People",
    icon: "IconStethoscope",
    description: "Campaign 3: cash-pay functional medicine leads sourced from Clodo (lead-source test, Nov 2026)",
    fields: {
      jobTitle: text,
      companyName: text,
      website: text,
      domain: text,
      location: text,
      linkedinUrl: text,
      employeeCount: number,
      industry: text,
      email: text,
      emailSource: select(["CLODO_LOOKUP", "CLODO_DEEP_SEARCH", "SITE_PUBLISHED", "PATTERN_GUESS"]),
      emailType: select(["PERSONAL", "PRACTICE_INBOX", "GUESSED"]),
      emailVerification: select(["NOT_CHECKED", "VALID", "INVALID", "CATCH_ALL", "UNKNOWN"]),
      backupEmail: text,
      cohort: select(["C3_COHORT_1", "C3_COHORT_2", "C3_COHORT_3"]),
      leadSource: select(["CLODO_PEOPLE_SEARCH", "CLODO_DEEP_SEARCH"]),
      clodoJobId: text,
      clodoScore: number,
      fitStatus: select(["FIT", "MAYBE", "NOT_A_FIT"]),
      fitReason: text,
      paymentModel: select(["CASH_PAY", "INSURANCE", "MIXED", "UNKNOWN"]),
      techStack: text,
      caseStudy: select(["YUNIQUE", "PRECISION_EPIGENETICS", "GENERIC"]),
      researchStatus: select(["NOT_STARTED", "IN_RESEARCH", "VERIFIED", "NOT_A_FIT"]),
      notes: text,
      subjectLine: text,
      email1: text,
      email2: text,
      email3: text,
      researchSummary: text,
      sourceLinks: text,
      draftFlags: text,
      ...SEQUENCE_FIELDS,
    },
  },
];

const CAMPAIGN_4 = [
  {
    nameSingular: "campaign4Organization",
    namePlural: "campaign4Organizations",
    labelSingular: "C4 Organization",
    labelPlural: "C4 Organizations",
    icon: "IconBuildingCommunity",
    description: "Campaign 4: behavioral health nonprofits (MHA affiliates and Clubhouses) with IRS 990 data",
    fields: {
      legalName: text,
      source: select(["MHA_AFFILIATE", "CLUBHOUSE", "BOTH"]),
      clubhouses: text,
      website: text,
      domain: text,
      city: text,
      state: text,
      ein: text,
      nteeCode: text,
      revenue: number,
      latestFilingYear: number,
      officerCompensation: number,
      fiscalYearEndMonth: number,
      budgetWave: select(["JANUARY_FY", "JULY_FY", "OTHER_FY", "UNKNOWN"]),
      sizeTier: select(["UNDER_500K", "FROM_500K_TO_1M", "FROM_1M_TO_5M", "OVER_5M", "UNKNOWN"]),
      irsMatch: select(["HIGH", "MEDIUM", "NONE"]),
      fitStatus: select(["NOT_REVIEWED", "FIT", "TOO_SMALL", "GOVERNMENT", "NOT_A_FIT"]),
      propublicaUrl: text,
      directoryUrl: text,
      about: text,
      publishedEmails: text,
      researchSummary: text,
    },
  },
  {
    nameSingular: "campaign4Person",
    namePlural: "campaign4People",
    labelSingular: "C4 Person",
    labelPlural: "C4 People",
    icon: "IconUserHeart",
    description: "Campaign 4: decision makers at behavioral health nonprofits",
    fields: {
      jobTitle: text,
      roleType: select(["EXECUTIVE", "OPERATIONS", "PROGRAM", "CLINICAL", "CLUBHOUSE_DIRECTOR", "OTHER"]),
      email: text,
      emailType: select(["PERSONAL", "ORG_INBOX", "GUESSED"]),
      emailVerification: select(["NOT_CHECKED", "SAFE", "RISKY", "INVALID", "UNKNOWN"]),
      zerobounceStatus: select(["NOT_CHECKED", "VALID", "INVALID", "CATCH_ALL", "DO_NOT_MAIL", "UNKNOWN"]),
      emailSource: text,
      sourceUrl: text,
      linkedinUrl: text,
      companyName: text,
      cohort: select(["C4_COHORT_1", "C4_COHORT_2", "C4_COHORT_3"]),
      researchStatus: select(["NOT_STARTED", "IN_RESEARCH", "VERIFIED", "NOT_A_FIT"]),
      notes: text,
      ...SEQUENCE_FIELDS,
    },
    relations: [{ name: "organization", label: "Organization", target: "campaign4Organization", targetFieldLabel: "People", targetFieldIcon: "IconUsers" }],
  },
];

const OBJECTS = { "3": CAMPAIGN_3, "4": CAMPAIGN_4 }[CAMPAIGN];
if (!OBJECTS) throw new Error("pass --campaign 3 or --campaign 4");

// New relations on the 5.6M-row timelineActivity table are validated and indexed by background jobs
// (IS_DEFERRED_WORKSPACE_MIGRATION_ACTIONS_ENABLED); Twenty refuses further schema changes until they finish.
async function metadata(query, variables) {
  for (let attempt = 1; attempt <= 60; attempt++) {
    const res = await fetch(METADATA_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.TWENTY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors?.some((error) => error.extensions?.subCode === "DEFERRED_WORKSPACE_MIGRATION_ACTIONS_IN_PROGRESS")) {
      if (attempt === 1) console.log("  waiting for background schema jobs...");
      await new Promise((resolve) => setTimeout(resolve, 20000));
      continue;
    }
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error("background schema jobs did not finish within 20 minutes");
}

async function existingObjects() {
  const data = await metadata(`{ objects(paging: { first: 300 }) { edges { node { id nameSingular fields(paging: { first: 200 }) { edges { node { name } } } } } } }`);
  return new Map(data.objects.edges.map(({ node }) => [node.nameSingular, { id: node.id, fields: new Set(node.fields.edges.map((edge) => edge.node.name)) }]));
}

const labelFor = (name) => name.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase()).replace(/\bEin\b/, "EIN").replace(/\bNtee\b/, "NTEE");

async function createField(objectMetadataId, field) {
  if (DRY_RUN) return console.log(`  would create field ${field.name} (${field.type})`);
  await metadata(`mutation CreateField($input: CreateOneFieldMetadataInput!) { createOneField(input: $input) { id } }`, {
    input: { field: { objectMetadataId, ...field } },
  });
  console.log(`  created field ${field.name}`);
}

let objects = await existingObjects();
for (const definition of OBJECTS) {
  if (!objects.has(definition.nameSingular)) {
    if (DRY_RUN) {
      console.log(`would create object ${definition.nameSingular} with ${Object.keys(definition.fields).length} fields`);
      continue;
    }
    const { fields, relations, ...object } = definition;
    await metadata(`mutation CreateObject($input: CreateOneObjectInput!) { createOneObject(input: $input) { id } }`, { input: { object } });
    console.log(`created object ${definition.nameSingular}`);
    objects = await existingObjects();
  }
  const current = objects.get(definition.nameSingular);
  console.log(`${definition.nameSingular} (${current.id})`);
  for (const [name, spec] of Object.entries(definition.fields)) {
    if (current.fields.has(name)) continue;
    await createField(current.id, { name, label: labelFor(name), ...spec });
  }
  for (const relation of definition.relations || []) {
    if (current.fields.has(relation.name)) continue;
    const target = objects.get(relation.target);
    if (!target) throw new Error(`relation target ${relation.target} missing`);
    await createField(current.id, {
      name: relation.name,
      label: relation.label,
      type: "RELATION",
      icon: "IconBuildingCommunity",
      relationCreationPayload: { type: "MANY_TO_ONE", targetObjectMetadataId: target.id, targetFieldLabel: relation.targetFieldLabel, targetFieldIcon: relation.targetFieldIcon },
    });
  }
}
