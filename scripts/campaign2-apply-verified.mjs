// Writes verified cohort research (from the verification results files) into Twenty:
// campaign2People gets research status, owner name, verified fact and a changed email (only after Reacher
// rates it safe or risky); the person's cohort copy record gets the subject line, research, signals and sources.
// FAIL results are left IN_RESEARCH. Dry run unless --save.
// Usage: node scripts/campaign2-apply-verified.mjs <results-dir> <created.json> [--save]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const [resultsDir, createdFile] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const SAVE = process.argv.includes("--save");
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

async function reacher(email) {
  const res = await fetch((process.env.REACHER_URL || "http://reacher.beenex.org") + "/v0/check_email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-reacher-secret": process.env.REACHER_SECRET },
    body: JSON.stringify({ to_email: email }),
    signal: AbortSignal.timeout(120000),
  }).catch(() => null);
  if (!res?.ok) return "error";
  return (await res.json()).is_reachable;
}

const COPY_BY_COHORT = {
  C2_COHORT_1: { relation: "cohort1Copy", object: "Campaign2CohortOne" },
  C2_COHORT_2: { relation: "cohort2Copy", object: "Campaign2CohortTwo" },
  C2_COHORT_3: { relation: "cohort3Copy", object: "Campaign2CohortThree" },
  C2_COHORT_4: { relation: "cohort4Copy", object: "Campaign2CohortFour" },
};

const tokens = (name = "") => new Set(name.toLowerCase().replace(/^dr\.?\s+/, "").split(/[^a-z]+/).filter((t) => t.length > 2));

const results = fs.readdirSync(resultsDir).filter((f) => /^results-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(resultsDir, f), "utf8")));
const personIdByIssue = new Map(JSON.parse(fs.readFileSync(createdFile, "utf8")).map((c) => [c.identifier, c.campaign2PersonId]));

const tally = {};
for (const result of results) {
  const personId = personIdByIssue.get(result.issue);
  if (!personId) { console.log("no person for", result.issue); continue; }
  const { campaign2Person: person } = await gql(
    `query($id: UUID!) { campaign2Person(filter: { id: { eq: $id } }) { id name email notes cohort
      ${Object.values(COPY_BY_COHORT).map((c) => `${c.relation} { edges { node { id } } }`).join(" ")} } }`,
    { id: personId },
  );
  const copyTarget = COPY_BY_COHORT[person.cohort];
  const copyId = person[copyTarget.relation].edges[0]?.node.id;
  const failed = result.verdict === "FAIL";
  const notAFit = result.fit === "NOT_A_FIT";
  const personData = { researchStatus: failed ? "IN_RESEARCH" : notAFit ? "NOT_A_FIT" : "VERIFIED" };
  const notes = [`[${STAMP}] Linear ${result.issue}: ${result.verdict}, fit ${result.fit.toLowerCase().replace("_", " ")}.`];
  if (!failed && !notAFit && !result.emailToUse) notes.push("No published email confirmed: hold until one is found.");

  if (!failed) {
    if (result.verifiedFact) personData.verifiedFact = result.verifiedFact;
    // Verifiers sometimes annotate the owner, e.g. "Jane Doe (co-owner with ...)"; only the name belongs on the record.
    const owner = (result.ownerName || "").replace(/\s*\([^)]*\)/g, "").trim();
    const overlap = [...tokens(owner)].some((t) => tokens(person.name).has(t));
    if (owner && !overlap) {
      personData.name = owner;
      notes.push(`Name on file was "${person.name}"; verified owner/decision maker is ${owner}.`);
    }
    if (result.ownerTitle) personData.jobTitle = result.ownerTitle;
    const newEmail = (result.emailToUse || "").trim().toLowerCase();
    if (!notAFit && newEmail && newEmail !== person.email.toLowerCase() && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(newEmail)) {
      const verdict = await reacher(newEmail);
      if (["safe", "risky"].includes(verdict)) {
        personData.email = newEmail;
        personData.emailSource = `Verified research ${STAMP} (${result.issue}): published on ${result.emailPublishedOn}; Reacher ${verdict}. Previous: ${person.email}`;
        notes.push(`Email changed from ${person.email} to ${newEmail} (Reacher ${verdict}).`);
      } else {
        notes.push(`Research suggests ${newEmail} (published on ${result.emailPublishedOn}) but Reacher said ${verdict}; kept ${person.email}.`);
      }
    }
    if (result.doNotMention?.length) notes.push(`Do not mention: ${result.doNotMention.join("; ")}.`);
  } else if (result.corrections?.length) {
    notes.push(`Sent back to Grokbot: ${result.corrections.join("; ")}`);
  }
  personData.notes = [person.notes, notes.join(" ")].filter(Boolean).join(" ");

  const copyData = failed ? null : {
    subjectLine: notAFit ? "" : result.subjectLine || "",
    researchSummary: result.researchSummary || "",
    socialSignals: result.socialSignals || "",
    sourceLinks: result.sourceLinks || "",
    placeholders: {
      ownerName: personData.name || person.name,
      firstSentence: result.firstSentence || "",
      verifiedFact: result.verifiedFact || "",
      fit: result.fit,
      doNotMention: result.doNotMention || [],
      linearIssue: result.issue,
    },
  };

  const key = failed ? "FAIL" : notAFit ? "NOT_A_FIT" : "VERIFIED";
  tally[key] = (tally[key] || 0) + 1;
  if (personData.email) tally.emailChanged = (tally.emailChanged || 0) + 1;
  if (personData.name) tally.renamed = (tally.renamed || 0) + 1;
  if (!SAVE) continue;
  await gql(`mutation($id: UUID!, $data: Campaign2PersonUpdateInput!) { updateCampaign2Person(id: $id, data: $data) { id } }`, { id: personId, data: personData });
  if (copyData && copyId) {
    await gql(`mutation($id: UUID!, $data: ${copyTarget.object}UpdateInput!) { update${copyTarget.object}(id: $id, data: $data) { id } }`, { id: copyId, data: { ...copyData, ...(personData.name ? { name: personData.name } : {}) } });
  }
}
console.log(SAVE ? "saved" : "dry run", results.length, "results", tally);
