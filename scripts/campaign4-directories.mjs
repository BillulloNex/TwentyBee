// Campaign 4 source list: every Mental Health America affiliate and every US Clubhouse International
// member, with address, website and (for clubhouses) the listed director and email.
// Read-only; writes artifacts/campaign-4-leads/directory-orgs.json.
// Usage: node scripts/campaign4-directories.mjs [--concurrency N]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "artifacts", "campaign-4-leads");
const args = process.argv.slice(2);
const CONCURRENCY = args.includes("--concurrency") ? Number(args[args.indexOf("--concurrency") + 1]) : 6;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const decode = (text) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&#8217;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const toText = (html) =>
  decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  return null;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

const normalizeWebsite = (url) => {
  if (!url) return null;
  const withScheme = /^https?:\/\//i.test(url) ? url : "https://" + url;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
};

const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

async function mhaAffiliates() {
  const sitemap = await get("https://mhanational.org/affiliates-sitemap.xml");
  const links = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1])
    .filter((url) => /\/affiliates\/[^/]+\/$/.test(url));
  console.log(`MHA: ${links.length} affiliate pages`);
  return mapLimit(links, CONCURRENCY, async (url) => {
    const html = await get(url);
    if (!html) return { source: "MHA_AFFILIATE", directoryUrl: url, error: "page not found" };
    const main = (html.match(/<main[\s\S]*?<\/main>/) || [html])[0];
    const lines = toText(main);
    const name = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]?.replace(/<[^>]+>/g, "").trim() || "");
    const aboutStart = lines.indexOf("About This Affiliate");
    const addressStart = lines.indexOf("Affiliate Address");
    const about = aboutStart >= 0 ? lines.slice(aboutStart + 1, addressStart > aboutStart ? addressStart : aboutStart + 6).join(" ") : "";
    const addressLines = addressStart >= 0 ? lines.slice(addressStart + 1, addressStart + 6) : [];
    const cutoff = addressLines.findIndex((line) => /^(Phone|Website|Email):?$/i.test(line) || /^Related items$/i.test(line));
    const address = cutoff >= 0 ? addressLines.slice(0, cutoff) : addressLines.slice(0, 3);
    const cityLine = address.find((line) => /,\s*[A-Z]{2}\s+\d{5}/.test(line)) || "";
    const cityMatch = cityLine.match(/^(.*),\s*([A-Z]{2})\s+(\d{5})/);
    const after = (label) => {
      const index = lines.findIndex((line) => line.replace(/:$/, "").toLowerCase() === label);
      return index >= 0 ? lines[index + 1] : null;
    };
    const externalLinks = [...main.matchAll(/href="(https?:\/\/[^"]+)"/g)]
      .map((match) => match[1])
      .filter((href) => !/mhanational\.org|facebook|twitter|instagram|linkedin|youtube|google\.com\/maps/i.test(href));
    const website = normalizeWebsite(externalLinks[0] || after("website"));
    return {
      source: "MHA_AFFILIATE",
      name: name || lines[lines.indexOf("About This Affiliate") - 1] || null,
      directoryUrl: url,
      about: about || null,
      street: address[0] && address[0] !== cityLine ? address[0] : null,
      city: cityMatch ? cityMatch[1].trim() : null,
      state: cityMatch ? cityMatch[2] : null,
      zip: cityMatch ? cityMatch[3] : null,
      phone: after("phone"),
      website,
      domain: domainOf(website),
    };
  });
}

const STATE_CODES = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  "Puerto Rico": "PR",
};

async function clubhouses() {
  const html = await get("https://clubhouse-intl.org/Clubhouse-Directory");
  const items = [...html.matchAll(/<div class="dir-map-item"([\s\S]*?)>/g)].map((match) => {
    const attrs = {};
    for (const [, key, value] of match[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)) attrs[key] = decode(value).trim();
    return attrs;
  });
  const us = items.filter((item) => item.country === "USA");
  console.log(`Clubhouse International: ${items.length} listed, ${us.length} in the USA`);
  return us.map((item) => {
    const website = normalizeWebsite(item.website);
    return {
      source: "CLUBHOUSE",
      name: item.name,
      directoryUrl: item.link ? "https://clubhouse-intl.org" + item.link : null,
      accreditation: item["type-accredited"] === "1" ? "ACCREDITED" : item["type-training-center"] === "1" ? "TRAINING_CENTER" : "NOT_ACCREDITED",
      street: item.address || null,
      city: item.city || null,
      state: STATE_CODES[item.state] || item.state || null,
      zip: item.zip || null,
      phone: item.phone || null,
      website,
      domain: domainOf(website),
      directorName: item.director || null,
      directorEmail: item.email || null,
    };
  });
}

const [mha, clubs] = await Promise.all([mhaAffiliates(), clubhouses()]);
const all = [...mha, ...clubs];
fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, "directory-orgs.json");
fs.writeFileSync(outFile, JSON.stringify(all, null, 2));
console.log(`wrote ${all.length} entries to ${path.relative(process.cwd(), outFile)}`);
console.log(`MHA with website: ${mha.filter((org) => org.website).length}/${mha.length}`);
console.log(`Clubhouses with director email: ${clubs.filter((org) => org.directorEmail).length}/${clubs.length}`);
