// Campaign 4: matches each directory org to its IRS filer on ProPublica Nonprofit Explorer and records
// revenue, expenses, fiscal year end and officer pay. Clubhouses are often a program of a larger agency,
// so the homepage title of the listed website is searched too. Read-only; reads directory-orgs.json and
// writes artifacts/campaign-4-leads/orgs-990.json.
// Usage: node scripts/campaign4-990.mjs [--limit N]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "artifacts", "campaign-4-leads");
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const PROPUBLICA = "https://projects.propublica.org/nonprofits/api/v2";
const SOCIAL_HOSTS = /facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|linktr\.ee/i;
const STOP_WORDS = new Set(["inc", "the", "of", "and", "for", "a", "in", "at", "corp", "corporation", "co", "assn", "association", "assoc", "org", "home", "welcome", "llc", "nfp"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decode = (text) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&#8217;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const tokens = (name) =>
  (name || "")
    .toLowerCase()
    .replace(/\bmha\b/g, "mental health america")
    .replace(/\bmhc\b/g, "mental health")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word));

// Words every affiliate shares; a match has to agree on the rest (place names, program names).
const GENERIC_WORDS = new Set(["mental", "health", "america", "county", "counties", "center", "centers", "services", "service", "behavioral", "community", "clubhouse", "club", "house", "greater", "area", "region", "regional", "program", "programs", "inc"]);
const distinctive = (name) => tokens(name).filter((word) => !GENERIC_WORDS.has(word));

// Place and program words must all agree; shared generic words only add a little.
function similarity(left, right) {
  const orgWords = tokens(left);
  const orgDistinctive = distinctive(left);
  const candidateWords = new Set(tokens(right));
  if (!orgWords.length) return 0;
  const fullShare = orgWords.filter((word) => candidateWords.has(word)).length / orgWords.length;
  if (!orgDistinctive.length) return fullShare;
  const distinctiveShare = orgDistinctive.filter((word) => candidateWords.has(word)).length / orgDistinctive.length;
  return 0.6 * distinctiveShare + 0.4 * fullShare;
}

async function fetchJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "BeeNex research" }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
    } catch {}
    await sleep(2000 * attempt);
  }
  return null;
}

async function siteName(website) {
  if (!website || SOCIAL_HOSTS.test(website)) return null;
  try {
    const res = await fetch(website, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    const ogSite = html.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)/i)?.[1];
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const pick = (text) =>
      decode(text || "")
        .split(/\s[|\-–—:]\s/)
        .map((part) => part.trim())
        .filter((part) => part && !/^(home|homepage|welcome)$/i.test(part))
        .sort((a, b) => b.length - a.length)[0] || null;
    return { siteName: pick(ogSite) || pick(title), finalUrl: res.url };
  } catch {
    return null;
  }
}

async function search(query, state) {
  const url = `${PROPUBLICA}/search.json?q=${encodeURIComponent(query)}${state ? `&state%5Bid%5D=${state}` : ""}`;
  const data = await fetchJson(url);
  await sleep(400);
  return data?.organizations || [];
}

const MENTAL_HEALTH_NAME = /mental|behavioral|psych|mha\b|wellness|recovery/i;

function score(candidate, names, org) {
  const mentalHealthNtee = /^F/.test(candidate.ntee_code || "");
  if (org.source === "MHA_AFFILIATE" && !mentalHealthNtee && !MENTAL_HEALTH_NAME.test(candidate.name)) return 0;
  const nameScore = Math.max(...names.map((name) => similarity(name, candidate.name)));
  const sameCity = org.city && candidate.city && candidate.city.toLowerCase().slice(0, 6) === org.city.toLowerCase().slice(0, 6) ? 0.1 : 0;
  return nameScore + sameCity + (mentalHealthNtee ? 0.1 : 0);
}

async function matchOrg(org) {
  const site = await siteName(org.website);
  const names = [org.name, site?.siteName].filter(Boolean);
  const queries = [...new Set(names.flatMap((name) => [tokens(name).join(" "), distinctive(name).join(" ")]).filter(Boolean))];
  const candidates = new Map();
  for (const query of queries) {
    for (const candidate of await search(query, org.state)) candidates.set(candidate.ein, candidate);
  }
  const ranked = [...candidates.values()]
    .map((candidate) => ({ candidate, score: score(candidate, names, org) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const base = { ...org, siteName: site?.siteName || null, websiteResolved: site?.finalUrl || null };
  if (!best || best.score < 0.75) {
    return { ...base, irsMatch: "NONE", irsCandidates: ranked.slice(0, 3).map(({ candidate, score }) => `${candidate.name} (${candidate.city}) ${score.toFixed(2)}`) };
  }
  const detail = await fetchJson(`${PROPUBLICA}/organizations/${best.candidate.ein}.json`);
  await sleep(400);
  const profile = detail?.organization || {};
  const latest = (detail?.filings_with_data || [])[0] || {};
  const fiscalYearEndMonth = profile.tax_period ? Number(profile.tax_period.slice(5, 7)) : latest.tax_prd ? latest.tax_prd % 100 : null;
  return {
    ...base,
    irsMatch: best.score >= 1 ? "HIGH" : "MEDIUM",
    irsMatchScore: Number(best.score.toFixed(2)),
    ein: String(best.candidate.ein).padStart(9, "0"),
    legalName: profile.name || best.candidate.name,
    irsCity: profile.city || best.candidate.city,
    nteeCode: profile.ntee_code || best.candidate.ntee_code || null,
    revenue: profile.revenue_amount ?? latest.totrevenue ?? null,
    assets: profile.asset_amount ?? latest.totassetsend ?? null,
    latestFilingYear: latest.tax_prd_yr || null,
    latestFilingRevenue: latest.totrevenue ?? null,
    latestFilingExpenses: latest.totfuncexpns ?? null,
    officerCompensation: latest.compnsatncurrofcr ?? null,
    otherSalaries: latest.othrsalwages ?? null,
    fiscalYearEndMonth,
    propublicaUrl: `https://projects.propublica.org/nonprofits/organizations/${best.candidate.ein}`,
    latestFilingPdf: (detail?.filings_with_data || []).find((filing) => filing.pdf_url)?.pdf_url || null,
  };
}

const orgs = JSON.parse(fs.readFileSync(path.join(DIR, "directory-orgs.json"), "utf8")).slice(0, LIMIT);
const results = [];
let done = 0;
const queue = [...orgs];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const org = queue.shift();
      try {
        results.push(await matchOrg(org));
      } catch (error) {
        results.push({ ...org, irsMatch: "ERROR", error: String(error) });
      }
      if (++done % 25 === 0) console.log(`${done}/${orgs.length}`);
    }
  }),
);
fs.writeFileSync(path.join(DIR, "orgs-990.json"), JSON.stringify(results, null, 2));
const count = (key) => results.reduce((map, org) => ((map[org[key]] = (map[org[key]] || 0) + 1), map), {});
console.log("IRS match", count("irsMatch"));
