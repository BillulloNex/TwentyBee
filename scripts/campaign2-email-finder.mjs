// Campaign 2 email finder: picks uncohorted, high-confidence leads at functional / integrative
// practices, matches each to a practice website, crawls a few pages for published addresses and
// checks the domain has MX. Read-only against Twenty; writes a review file under artifacts/.
// --include-medium also takes MEDIUM-confidence people; --practices instead crawls ICP practices from the
// PDL / Overture tables that have no person in campaign1People yet (the result is a practice inbox).
// Usage: node scripts/campaign2-email-finder.mjs [--include-medium | --practices] [--tag name] [--limit N] [--concurrency N]

import fs from "fs";
import path from "path";
import dns from "dns/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const API_KEY = process.env.TWENTY_API_KEY;
const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const LIMIT = argValue("--limit", Infinity);
const CONCURRENCY = argValue("--concurrency", 8);
const INCLUDE_MEDIUM = args.includes("--include-medium");
const PRACTICES = args.includes("--practices");
const TAG = args.includes("--tag") ? "-" + args[args.indexOf("--tag") + 1] : "";
const OUT_DIR = path.join(__dirname, "..", "artifacts", "campaign-2-leads");

const ICP_PATTERN = /functional|integrative|longevity|wellness|holistic|naturopath/i;
const PAGE_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/our-team", "/team"];
const NON_PRACTICE_HOSTS = /linkedin\.com|facebook\.com|instagram\.com|youtube\.com|twitter\.com|x\.com|yelp\.com|healthgrades|vitals\.com|zocdoc|doximity|npiprofile|prnewswire|businesswire|patch\.com|medium\.com|wikipedia|google\.|withcherry|carecredit|squareup|wixsite|godaddysites|linktr\.ee/i;
const NOT_A_PERSON = /university|college|executive|practice|director|details|acupuncturist|company|experienced|independent|professional|taping|owner|founder|licensed|secondary|medical|health|wellness|integrative|functional|clinic|center|team|staff/i;
const JUNK_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|example\.|domain\.com|yourdomain|email\.com|godaddy|squarespace|@2x/i;

async function gql(query, variables) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" },
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

async function fetchAll(objectName, fields) {
  const records = [];
  let after = null;
  for (;;) {
    const data = await gql(
      `query($after: String) { ${objectName}(first: 200, after: $after) { pageInfo { hasNextPage endCursor } edges { node { ${fields} } } } }`,
      { after },
    );
    const page = data[objectName];
    records.push(...page.edges.map((edge) => edge.node));
    if (!page.pageInfo.hasNextPage) return records;
    after = page.pageInfo.endCursor;
  }
}

const normalizeCompany = (name = "") =>
  name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(llc|pllc|inc|pc|pa|the|of|md|center|centre|clinic)\b/g, " ").replace(/\s+/g, " ").trim();

function hostOf(url) {
  if (!url) return null;
  try {
    const host = new URL(/^https?:\/\//.test(url) ? url : "https://" + url).hostname.replace(/^www\./, "");
    return NON_PRACTICE_HOSTS.test(host) ? null : host;
  } catch {
    return null;
  }
}

// Only trust a sourceUrl as the practice site when its domain echoes the practice name; otherwise it is a news or directory page.
function sourceHostIfPractice(url, companyKey) {
  const host = hostOf(url);
  if (!host) return null;
  const label = host.split(".").slice(-2, -1)[0] ?? "";
  return companyKey.split(" ").some((word) => word.length > 3 && label.includes(word)) ? host : null;
}

function decodeCloudflare(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/126 Safari/537.36" },
    });
    if (!res.ok) return null;
    return { html: await res.text(), finalHost: new URL(res.url).hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function extractEmails(html) {
  const found = new Set();
  const text = html.replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, "@");
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) found.add(match[0].toLowerCase());
  for (const match of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) found.add(decodeCloudflare(match[1]).toLowerCase());
  return [...found].filter((email) => !JUNK_EMAIL.test(email));
}

const hasMx = new Map();
async function domainHasMx(domain) {
  if (!hasMx.has(domain)) {
    hasMx.set(domain, dns.resolveMx(domain).then((records) => records.length > 0).catch(() => false));
  }
  return hasMx.get(domain);
}

function personTokens(name = "") {
  return name.toLowerCase().replace(/^dr\.?\s+/, "").replace(/,.*$/, "").split(/\s+/)
    .map((token) => token.replace(/[^a-z]/g, "")).filter((token) => token.length > 1 && !["md", "do", "nd", "dc", "np"].includes(token));
}

function rankEmail(email, tokens, practiceHost) {
  const [local, domain] = email.split("@");
  const sameDomain = practiceHost && (domain === practiceHost || domain.endsWith("." + practiceHost) || practiceHost.endsWith(domain));
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const personal = tokens.length > 0 && ((last && local.includes(last)) || (first && first.length > 2 && local.startsWith(first)));
  if (personal && sameDomain) return { score: 3, kind: "PERSONAL" };
  if (personal) return { score: 2, kind: "PERSONAL_OFFDOMAIN" };
  if (sameDomain) return { score: 1, kind: "PRACTICE_INBOX" };
  return { score: 0, kind: "OTHER" };
}

async function findEmail(lead) {
  const tokens = personTokens(lead.name);
  const candidates = new Map();
  let reachedHost = null;
  const queue = [...PAGE_PATHS];
  for (let index = 0; index < queue.length && index < 10; index++) {
    const pagePath = queue[index];
    const page = await fetchPage(/^https?:/.test(pagePath) ? pagePath : "https://" + lead.host + pagePath);
    if (!page) continue;
    reachedHost ??= page.finalHost;
    if (index === 0) {
      for (const link of page.html.matchAll(/href="([^"#?]*(?:contact|about|team|provider|staff)[^"#?]*)"/gi)) {
        try {
          const url = new URL(link[1], "https://" + page.finalHost);
          if (url.hostname.replace(/^www\./, "") === page.finalHost && !queue.includes(url.pathname)) queue.splice(1, 0, url.pathname);
        } catch {}
      }
    }
    for (const email of extractEmails(page.html)) {
      if (!candidates.has(email)) candidates.set(email, pagePath || "/");
    }
    const personalFound = [...candidates.keys()].some((email) => rankEmail(email, tokens, reachedHost).score === 3);
    if (personalFound) break;
  }
  const ranked = [...candidates.entries()]
    .map(([email, foundOn]) => ({ email, foundOn, ...rankEmail(email, tokens, reachedHost || lead.host) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || /^(info|office|contact|hello|admin)@/.test(b.email) - /^(info|office|contact|hello|admin)@/.test(a.email));
  const best = ranked[0];
  const mx = best ? await domainHasMx(best.email.split("@")[1]) : false;
  return {
    siteReachable: Boolean(reachedHost),
    email: best?.email ?? "",
    emailKind: best?.kind ?? "",
    foundOn: best ? "https://" + lead.host + best.foundOn : "",
    mx,
    otherEmails: ranked.slice(1, 4).map((candidate) => candidate.email).join("; "),
  };
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
      if (++done % 25 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
  return results;
}

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

async function main() {
  console.log("Loading Twenty records...");
  const [people, overture, pdl] = await Promise.all([
    fetchAll("campaign1People", "id name jobTitle companyName companySource confidence email cohort sourceUrl"),
    fetchAll("overtureCashPayPractices", "name website city state matchedKeyword"),
    fetchAll("pdlCashPayCompanies", "name website locality region matchedKeyword"),
  ]);

  const websiteByCompany = new Map();
  for (const practice of [...overture, ...pdl]) {
    const host = hostOf(practice.website);
    const key = normalizeCompany(practice.name);
    if (host && key && !websiteByCompany.has(key)) {
      websiteByCompany.set(key, { name: practice.name, host, keyword: practice.matchedKeyword, location: [practice.city || practice.locality, practice.state || practice.region].filter(Boolean).join(", ") });
    }
  }

  const contacted = people.filter((person) => person.cohort);
  const contactedCompanies = new Set(contacted.map((person) => normalizeCompany(person.companyName)));
  const contactedDomains = new Set(contacted.map((person) => person.email?.split("@")[1]).filter(Boolean));

  const skipped = { notIcp: 0, notHighConfidence: 0, badName: 0, campaign1Company: 0, noWebsite: 0, campaign1Domain: 0 };
  const leads = [];
  if (PRACTICES) {
    const knownCompanies = new Set(people.map((person) => normalizeCompany(person.companyName)));
    const knownDomains = new Set(people.map((person) => person.email?.split("@")[1]?.toLowerCase()).filter(Boolean));
    const seenHosts = new Set();
    for (const [companyKey, practice] of websiteByCompany) {
      if (!ICP_PATTERN.test(practice.name + " " + practice.keyword)) { skipped.notIcp++; continue; }
      if (knownCompanies.has(companyKey)) { skipped.campaign1Company++; continue; }
      if (knownDomains.has(practice.host) || seenHosts.has(practice.host)) { skipped.campaign1Domain++; continue; }
      seenHosts.add(practice.host);
      leads.push({ id: "", name: "", jobTitle: "", companyName: practice.name, host: practice.host, keyword: practice.keyword, location: practice.location, websiteSource: "practice table" });
    }
  }
  const seenPeople = new Set();
  for (const person of PRACTICES ? [] : people) {
    if (person.cohort || person.email) continue;
    if (!ICP_PATTERN.test(person.companyName || "")) { skipped.notIcp++; continue; }
    if (person.confidence !== "HIGH" && !(INCLUDE_MEDIUM && person.confidence === "MEDIUM")) { skipped.notHighConfidence++; continue; }
    if (personTokens(person.name).length < 2 || NOT_A_PERSON.test(person.name)) { skipped.badName++; continue; }
    const companyKey = normalizeCompany(person.companyName);
    if (contactedCompanies.has(companyKey)) { skipped.campaign1Company++; continue; }
    const match = websiteByCompany.get(companyKey);
    const host = match?.host || sourceHostIfPractice(person.sourceUrl, companyKey);
    if (!host) { skipped.noWebsite++; continue; }
    if (contactedDomains.has(host)) { skipped.campaign1Domain++; continue; }
    const dedupeKey = person.name.toLowerCase() + "|" + host;
    if (seenPeople.has(dedupeKey)) continue;
    seenPeople.add(dedupeKey);
    leads.push({ ...person, host, keyword: match?.keyword ?? "", location: match?.location ?? "", websiteSource: match ? "practice table" : "sourceUrl" });
  }

  const batch = leads.slice(0, LIMIT);
  console.log(`Candidates: ${leads.length} (crawling ${batch.length}). Skipped:`, skipped);
  const found = await mapWithConcurrency(batch, findEmail);
  const rows = batch.map((lead, index) => ({ ...lead, ...found[index] }));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  if (!batch.length) return;
  const columns = ["id", "name", "jobTitle", "companyName", "location", "keyword", "host", "websiteSource", "siteReachable", "email", "emailKind", "mx", "foundOn", "otherEmails", "sourceUrl"];
  fs.writeFileSync(path.join(OUT_DIR, `email-finder-${stamp}${TAG}.json`), JSON.stringify({ skipped, rows }, null, 1));
  fs.writeFileSync(
    path.join(OUT_DIR, `email-finder-${stamp}${TAG}.csv`),
    [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n"),
  );

  const tally = rows.reduce((counts, row) => {
    const key = !row.siteReachable ? "SITE_DOWN" : !row.email ? "NO_EMAIL" : row.mx ? row.emailKind : row.emailKind + "_NO_MX";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  console.log("Results:", tally);
  console.log("Wrote", path.join(OUT_DIR, `email-finder-${stamp}${TAG}.csv`));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
