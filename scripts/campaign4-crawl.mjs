// Campaign 4: crawls each organization's site for leadership, staff, about and contact pages and keeps
// their text plus every published email, so decision makers can be extracted per org. One record per
// website domain (several clubhouses can share a parent agency). Read-only; reads orgs-990.json and
// writes artifacts/campaign-4-leads/org-pages.json.
// Usage: node scripts/campaign4-crawl.mjs [--limit N] [--concurrency N]

import fs from "fs";
import path from "path";
import dns from "dns/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "artifacts", "campaign-4-leads");
const args = process.argv.slice(2);
const argValue = (flag, fallback) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
const LIMIT = argValue("--limit", Infinity);
const CONCURRENCY = argValue("--concurrency", 6);
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const SOCIAL_HOSTS = /facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|linktr\.ee|google\.com/i;
const PAGE_HINT = /staff|team|leadership|about|who-we-are|who we are|our-people|our people|board|administration|management|directors|contact|clubhouse|programs?\b/i;
const FALLBACK_PATHS = ["/about", "/about-us", "/staff", "/our-staff", "/team", "/our-team", "/leadership", "/contact", "/contact-us"];
const JUNK_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|example\.|domain\.com|yourdomain|email\.com|godaddy|squarespace|@2x/i;
const MAX_PAGES = 7;
const MAX_CHARS_PER_PAGE = 6000;

const decode = (text) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&#8217;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const pageText = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<(header|nav|footer)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

const emailsIn = (html) => {
  const found = new Set();
  for (const match of html.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(decodeURIComponent(match[1]).toLowerCase());
  for (const match of decode(html).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) found.add(match[0].toLowerCase());
  return [...found].filter((email) => !JUNK_EMAIL.test(email));
};

async function get(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("html")) return null;
    return { html: await res.text(), url: res.url };
  } catch {
    return null;
  }
}

async function hasMx(domain) {
  try {
    return (await dns.resolveMx(domain)).length > 0;
  } catch {
    return false;
  }
}

async function crawl(domain, website) {
  const home = await get(website);
  if (!home) return { domain, website, reachable: false, pages: [], emails: [] };
  const origin = new URL(home.url).origin;
  const candidates = new Map();
  for (const match of home.html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href;
    try {
      href = new URL(match[1], origin);
    } catch {
      continue;
    }
    if (href.origin !== origin || /\.(pdf|jpe?g|png|docx?)$/i.test(href.pathname)) continue;
    const label = decode(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (PAGE_HINT.test(href.pathname) || PAGE_HINT.test(label)) {
      const key = href.origin + href.pathname.replace(/\/$/, "");
      const priority = /staff|team|leadership|our people|administration|management|directors/i.test(href.pathname + " " + label) ? 0 : /about|who/i.test(href.pathname + label) ? 1 : 2;
      if (!candidates.has(key) || candidates.get(key).priority > priority) candidates.set(key, { url: key, label, priority });
    }
  }
  for (const fallback of FALLBACK_PATHS) if (![...candidates.keys()].some((key) => key.endsWith(fallback))) candidates.set(origin + fallback, { url: origin + fallback, label: "", priority: 3 });
  const toVisit = [...candidates.values()].sort((a, b) => a.priority - b.priority).slice(0, MAX_PAGES);
  const pages = [{ url: home.url, label: "home", text: pageText(home.html).slice(0, MAX_CHARS_PER_PAGE) }];
  const emails = new Set(emailsIn(home.html));
  for (const candidate of toVisit) {
    const page = await get(candidate.url);
    if (!page || pages.some((existing) => existing.url === page.url)) continue;
    pages.push({ url: page.url, label: candidate.label, text: pageText(page.html).slice(0, MAX_CHARS_PER_PAGE) });
    for (const email of emailsIn(page.html)) emails.add(email);
  }
  return { domain, website: home.url, reachable: true, mx: await hasMx(domain), pages, emails: [...emails] };
}

const orgs = JSON.parse(fs.readFileSync(path.join(DIR, "orgs-990.json"), "utf8"));
const byDomain = new Map();
for (const org of orgs) {
  if (!org.domain || SOCIAL_HOSTS.test(org.domain)) continue;
  if (!byDomain.has(org.domain)) byDomain.set(org.domain, { domain: org.domain, website: org.websiteResolved || org.website, orgNames: [] });
  byDomain.get(org.domain).orgNames.push(org.name);
}
const targets = [...byDomain.values()].slice(0, LIMIT);
console.log(`${targets.length} domains to crawl`);
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < targets.length) {
      const target = targets[next++];
      results.push({ ...(await crawl(target.domain, target.website)), orgNames: target.orgNames });
      if (results.length % 25 === 0) console.log(`${results.length}/${targets.length}`);
    }
  }),
);
fs.writeFileSync(path.join(DIR, "org-pages.json"), JSON.stringify(results, null, 2));
console.log(`reachable ${results.filter((r) => r.reachable).length}/${results.length}, with emails ${results.filter((r) => r.emails.length).length}`);
