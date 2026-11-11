// Campaign 4: joins the directory listings, the IRS match and the crawled page text per website domain
// and splits them into batch files for the research agents (brief: scripts/campaign4-research-brief.md).
// Writes artifacts/campaign-4-leads/research/input-<n>.json.
// Usage: node scripts/campaign4-research-batches.mjs [--batches N]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "artifacts", "campaign-4-leads");
const args = process.argv.slice(2);
const BATCHES = args.includes("--batches") ? Number(args[args.indexOf("--batches") + 1]) : 8;
const STAFF_PAGE = /staff|team|leadership|people|administration|management|directors|who/i;
const MAX_CHARS_PER_ORG = 18000;

const orgs = JSON.parse(fs.readFileSync(path.join(DIR, "orgs-990.json"), "utf8"));
const crawled = JSON.parse(fs.readFileSync(path.join(DIR, "org-pages.json"), "utf8"));

const records = crawled.map((site) => {
  const listings = orgs.filter((org) => org.domain === site.domain);
  const irs = listings.find((org) => org.irsMatch && org.irsMatch !== "NONE");
  let budget = MAX_CHARS_PER_ORG;
  const pages = site.pages
    .map((page) => ({ ...page, staff: STAFF_PAGE.test(page.url + " " + page.label) }))
    .sort((a, b) => Number(b.staff) - Number(a.staff))
    .map((page) => {
      const limit = Math.min(budget, page.staff ? 8000 : page.label === "home" ? 2500 : 3000);
      budget -= Math.min(limit, page.text.length);
      return { url: page.url, text: page.text.slice(0, Math.max(limit, 0)) };
    })
    .filter((page) => page.text);
  return {
    domain: site.domain,
    website: site.website,
    reachable: site.reachable,
    directoryListings: listings.map((org) => ({
      source: org.source,
      name: org.name,
      city: org.city,
      state: org.state,
      about: org.about ? org.about.slice(0, 600) : null,
      clubhouseDirector: org.directorName || null,
      clubhouseDirectorEmail: org.directorEmail || null,
    })),
    irsMatch: irs ? { legalName: irs.legalName, city: irs.irsCity, state: irs.state, revenue: irs.revenue, matchScore: irs.irsMatchScore } : null,
    publishedEmails: site.emails,
    pages,
  };
});

const outDir = path.join(DIR, "research");
fs.mkdirSync(outDir, { recursive: true });
const size = Math.ceil(records.length / BATCHES);
for (let index = 0; index < BATCHES; index++) {
  const batch = records.slice(index * size, (index + 1) * size);
  if (!batch.length) continue;
  const file = path.join(outDir, `input-${index + 1}.json`);
  fs.writeFileSync(file, JSON.stringify(batch, null, 1));
  console.log(`${path.relative(process.cwd(), file)}: ${batch.length} orgs, ${Math.round(fs.statSync(file).size / 1024)} KB`);
}
