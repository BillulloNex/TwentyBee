// Campaign 3: free screening of Clodo leads. Drops people already in Campaign 1/2 (by email, company
// domain or name) or in earlier Clodo pulls, then fetches each clinic's site for cash-pay vs insurance
// evidence, whether the person is named on it, and the software it exposes (EHR, CRM, dispensary),
// which decides the case-study angle (Charm/GoHighLevel -> Yunique, formulations -> Precision Epigenetics).
// Read-only against Twenty. Writes <job file>-screen.json next to the Clodo job file.
// Usage: node scripts/campaign3-screen.mjs <clodo job json> [--exclude <earlier job json> ...]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const args = process.argv.slice(2);
const jobFile = args[0];
const excludeFiles = args.flatMap((arg, index) => (args[index - 1] === "--exclude" ? [arg] : []));

const STACK = {
  GoHighLevel: /leadconnectorhq|msgsndr|gohighlevel|api\.leadconnector/i,
  Charm: /charmtracker|charmhealth|charm\.health/i,
  Cerbo: /cerbo|md-hq\.com|mdhq/i,
  PracticeBetter: /practicebetter/i,
  Akute: /akutehealth|akute\.com/i,
  Elation: /elationhealth/i,
  Jane: /\.janeapp\.com|janeapp/i,
  Hint: /hinthealth|app\.hint\.com/i,
  Healthie: /gethealthie|healthie\.com/i,
  AtlasMD: /atlas\.md|atlasmd/i,
  Tebra: /kareo|tebra/i,
  Athena: /athenahealth|athenapatient/i,
  SimplePractice: /simplepractice/i,
  Fullscript: /fullscript/i,
  Emerson: /wellevate|emersonecologics/i,
  Mindbody: /mindbody/i,
  Calendly: /calendly/i,
  HubSpot: /hs-scripts\.com|hubspot/i,
};
const CASH_PAY = /do not (accept|bill|take) (any )?insurance|don.t (accept|take|bill) insurance|does not (currently )?accept (any )?insurance|out[- ]of[- ]network|cash[- ]pay|self[- ]pay|superbill|membership|concierge|direct primary care|fee[- ]for[- ]service|not in-network/i;
const TAKES_INSURANCE = /we accept (most )?(major )?(insurance|medicare)|in-network with|insurance accepted|insurance verification|accept(s)? (blue cross|aetna|cigna|united|bcbs)/i;
const FORMULATIONS = /peptide|compound|fullscript|dispensary|custom (supplement|formul)|epigenetic/i;

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

const hostOf = (value) => (value || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

async function get(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    return res.ok ? { html: await res.text(), url: res.url } : null;
  } catch {
    return null;
  }
}

const pageText = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&#\d+;/g, " ").replace(/\s+/g, " ");
const snippet = (text, pattern) => {
  const match = text.match(pattern);
  return match ? text.slice(Math.max(0, match.index - 80), match.index + 120).trim() : null;
};

async function screenSite(lead) {
  const domain = hostOf(lead.company?.domain);
  const home = domain ? await get("https://" + domain) : null;
  if (!home) return { reachable: false };
  const origin = new URL(home.url).origin;
  const links = [...home.html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((match) => {
      try {
        return new URL(match[1], origin);
      } catch {
        return null;
      }
    })
    .filter((url) => url && url.origin === origin && /pric|member|insur|faq|fee|cost|about|team|provider|new-patient|get-started|billing/i.test(url.pathname))
    .map((url) => url.href);
  const pages = [home];
  for (const link of [...new Set(links)].slice(0, 6)) pages.push(await get(link));
  const html = pages.filter(Boolean).map((page) => page.html).join("\n");
  const text = pageText(html);
  const cash = snippet(text, CASH_PAY);
  const insurance = snippet(text, TAKES_INSURANCE);
  const stack = Object.entries(STACK).filter(([, pattern]) => pattern.test(html)).map(([name]) => name);
  return {
    reachable: true,
    personOnSite: lead.last_name ? text.toLowerCase().includes(lead.last_name.toLowerCase()) : null,
    payment: cash && !insurance ? "CASH_PAY" : insurance && !cash ? "INSURANCE" : cash && insurance ? "MIXED" : "UNKNOWN",
    cashEvidence: cash,
    insuranceEvidence: insurance,
    stack,
    caseStudy: stack.includes("Charm") || stack.includes("GoHighLevel") ? "YUNIQUE" : FORMULATIONS.test(text) ? "PRECISION_EPIGENETICS" : "GENERIC",
  };
}

const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
const leads = job.result?.results || [];
const known = [
  ...(await fetchAll("campaign1People", "name email website")),
  ...(await fetchAll("campaign2People", "name email website")),
];
const knownEmails = new Set(known.map((person) => (person.email || "").toLowerCase()).filter(Boolean));
const knownDomains = new Set(known.flatMap((person) => [person.email?.split("@")[1], hostOf(person.website)]).filter(Boolean).map((domain) => domain.toLowerCase()));
const knownNames = new Set(known.map((person) => (person.name || "").toLowerCase()).filter(Boolean));
const earlier = excludeFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, "utf8")).result?.results || []);
const earlierUrls = new Set(earlier.map((lead) => lead.professional_url).filter(Boolean));
const earlierNames = new Set(earlier.map((lead) => `${lead.full_name}|${hostOf(lead.company?.domain)}`.toLowerCase()));

const screened = [];
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < leads.length) {
      const index = next++;
      const lead = leads[index];
      const domain = hostOf(lead.company?.domain);
      const email = (lead.email || "").toLowerCase();
      let duplicate = null;
      if (email && knownEmails.has(email)) duplicate = "CAMPAIGN_1_2_EMAIL";
      else if (domain && knownDomains.has(domain)) duplicate = "CAMPAIGN_1_2_DOMAIN";
      else if (knownNames.has((lead.full_name || "").toLowerCase())) duplicate = "CAMPAIGN_1_2_NAME";
      else if (earlierUrls.has(lead.professional_url) || earlierNames.has(`${lead.full_name}|${domain}`.toLowerCase())) duplicate = "EARLIER_CLODO_PULL";
      screened[index] = { index: index + 1, lead, duplicate, site: await screenSite(lead) };
    }
  }),
);

const outFile = jobFile.replace(/\.json$/, "-screen.json");
fs.writeFileSync(outFile, JSON.stringify(screened, null, 2));
const count = (pick) => screened.reduce((map, item) => ((map[pick(item)] = (map[pick(item)] || 0) + 1), map), {});
console.log(`${screened.length} leads -> ${path.relative(process.cwd(), outFile)}`);
console.log("duplicates", count((item) => item.duplicate || "none"));
console.log("with email from Clodo", screened.filter((item) => item.lead.email).length);
console.log("payment", count((item) => item.site.payment || "unreachable"));
console.log("case study", count((item) => item.site.caseStudy || "unreachable"));
console.log("person named on site", count((item) => String(item.site.personOnSite)));
