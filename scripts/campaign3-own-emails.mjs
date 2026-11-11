// Campaign 3 Cohort 1 ("we find the email ourselves"): crawls each lead's clinic site and picks the best
// published address: one matching the person's name, else another personal-looking address at the
// clinic's domain, else a shared inbox. Leads with nothing published get a first-name pattern guess,
// which must be verified before use. Writes <pool file>-own-emails.json.
// Usage: node scripts/campaign3-own-emails.mjs artifacts/campaign-3-leads/pool-cohort1-own-finding.json

import fs from "fs";
import dns from "dns/promises";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const PAGE_HINT = /contact|about|team|staff|provider|our-doctors|meet|people|leadership/i;
const SHARED_INBOX = /^(info|contact|hello|office|admin|frontdesk|front\.desk|support|team|appointments?|scheduling|reception|billing|care|clinic|help|inquiries|enquiries|patients?|newpatients?|wellness|health|mail)@/i;
const JUNK = /\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|example\.|domain\.com|yourdomain|email\.com|godaddy|squarespace|@2x/i;

const poolFile = process.argv[2];
const pool = JSON.parse(fs.readFileSync(poolFile, "utf8"));

async function get(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    return res.ok ? { html: await res.text(), url: res.url } : null;
  } catch {
    return null;
  }
}

const decode = (text) => text.replace(/&#64;|&#x40;/gi, "@").replace(/&#46;/g, ".").replace(/\s*\[at\]\s*/gi, "@").replace(/\s*\(at\)\s*/gi, "@");

function emailsIn(html) {
  const found = new Set();
  for (const match of html.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(decodeURIComponent(match[1]).toLowerCase());
  for (const match of decode(html).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) found.add(match[0].toLowerCase());
  return [...found].filter((email) => !JUNK.test(email));
}

const strip = (value) => (value || "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

function nameMatch(email, lead) {
  const local = strip(email.split("@")[0]);
  const first = strip(lead.first_name);
  const last = strip(lead.last_name);
  return (first.length > 2 && local.includes(first)) || (last.length > 2 && local.includes(last)) || (first && last && local === first[0] + last);
}

async function findFor(entry) {
  const lead = entry.lead;
  const domain = (lead.company?.domain || "").toLowerCase().replace(/^www\./, "");
  if (!domain) return { method: "NO_DOMAIN", email: null };
  const home = await get("https://" + domain);
  const emails = new Set();
  if (home) {
    emailsIn(home.html).forEach((email) => emails.add(email));
    const origin = new URL(home.url).origin;
    const links = [...home.html.matchAll(/href=["']([^"'#]+)["']/gi)]
      .map((match) => {
        try {
          return new URL(match[1], origin);
        } catch {
          return null;
        }
      })
      .filter((url) => url && url.origin === origin && PAGE_HINT.test(url.pathname))
      .map((url) => url.href);
    for (const path of ["/contact", "/contact-us", "/about", "/about-us"]) links.push(origin + path);
    for (const link of [...new Set(links)].slice(0, 8)) {
      const page = await get(link);
      if (page) emailsIn(page.html).forEach((email) => emails.add(email));
    }
  }
  const atDomain = [...emails].filter((email) => email.endsWith("@" + domain) || email.endsWith("." + domain));
  const personal = atDomain.find((email) => nameMatch(email, lead));
  if (personal) return { method: "PUBLISHED_PERSONAL", email: personal, published: [...emails] };
  const otherPerson = atDomain.find((email) => !SHARED_INBOX.test(email));
  const shared = atDomain.find((email) => SHARED_INBOX.test(email)) || [...emails].find((email) => SHARED_INBOX.test(email));
  let hasMx = false;
  try {
    hasMx = (await dns.resolveMx(domain)).length > 0;
  } catch {}
  const guess = hasMx && strip(lead.first_name) ? `${strip(lead.first_name)}@${domain}` : null;
  if (otherPerson) return { method: "PUBLISHED_OTHER_PERSON", email: otherPerson, fallbackShared: shared || null, guess, published: [...emails] };
  if (guess) return { method: "GUESS_FIRST_NAME", email: guess, fallbackShared: shared || null, published: [...emails] };
  if (shared) return { method: "PUBLISHED_SHARED", email: shared, published: [...emails] };
  return { method: home ? "NOTHING_FOUND" : "SITE_UNREACHABLE", email: null, published: [...emails] };
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < pool.length) {
      const index = next++;
      results[index] = { key: pool[index].key, name: pool[index].lead.full_name, company: pool[index].lead.company?.name, ...(await findFor(pool[index])) };
    }
  }),
);
const outFile = poolFile.replace(/\.json$/, "-own-emails.json");
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(results.reduce((map, result) => ((map[result.method] = (map[result.method] || 0) + 1), map), {}));
console.log(`wrote ${outFile}`);
