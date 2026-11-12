// Gathers Campaign 2 or 3 lead evidence with an agent CLI, then checks every quote and the email against the live page.
// Step 1 of the gather -> check -> write pipeline: agy fills gather.json per campaign2-gather-protocol.md, this script
// fetches each cited URL (plain fetch, then a Playwright render for JS sites) and marks each item VERIFIED, CLOSE,
// NOT_ON_PAGE, BROKEN_URL or PAGE_FAILED. Only VERIFIED and CLOSE items may be used by the writer.
// Results: artifacts/campaign-<n>-leads/gather-runs/<key>.json (key BEE-n for Campaign 2, C3-/C4-<id prefix> for Campaigns 3 and 4).
// Rerunning skips finished leads. Campaigns 3 and 4 use their own gather protocol and accept --only all.
// Usage: node scripts/campaign2-gather.mjs --only BEE-1,BEE-2 [--model claude-opus-4-6-thinking | claude-sonnet-4-6 | codex | claude-code:sonnet | pi:<model> | gemini-cli[:model] | perplexity:<sonar model>] [--concurrency 2]
//        node scripts/campaign2-gather.mjs --recheck BEE-1   (re-runs the check on an existing result)
//        node scripts/campaign2-gather.mjs --campaign 3 --only all --model pi:<model> --search [--protocol <file>]
//        --agy-homes ~/.agy-accounts/a,~/.agy-accounts/b runs agy under several signed-in accounts (one HOME each, workers
//        spread across them; a worker whose account hits its quota hands its lead back and stops). --voice-focus asks for
//        more owner-voice (social listening) items.

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const CAMPAIGN = option("--campaign") ?? "2";
const LEADS_DIR = path.join(__dirname, "..", "artifacts", `campaign-${CAMPAIGN}-leads`);
const OUT_DIR = option("--out-dir") ? path.resolve(option("--out-dir")) : path.join(LEADS_DIR, "gather-runs");
const PROTOCOL = fs.readFileSync(option("--protocol") ? path.resolve(option("--protocol")) : path.join(__dirname, `campaign${CAMPAIGN}-gather-protocol.md`), "utf8");
const MODEL = option("--model") ?? "claude-opus-4-6-thinking";
const CONCURRENCY = Number(option("--concurrency") ?? 2);
const AGY_HOMES = option("--agy-homes")?.split(",").map((home) => path.resolve(home.replace(/^~/, os.homedir()))) ?? [undefined];
const LEAD_TIMEOUT_MS = 25 * 60 * 1000;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function gql(query) {
  const res = await fetch((process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.TWENTY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
  return json.data;
}

// Twenty is the source of truth, but a local copy lets gathering continue while it is unreachable.
const LEADS_CACHE = path.join(LEADS_DIR, "leads-cache.json");

async function loadLeads(issues) {
  let leads;
  try {
    leads = await loadLeadsFromTwenty();
    const cached = fs.existsSync(LEADS_CACHE) ? JSON.parse(fs.readFileSync(LEADS_CACHE, "utf8")) : [];
    const byIssue = new Map(cached.map((lead) => [lead.issue, lead]));
    for (const lead of leads) byIssue.set(lead.issue, lead);
    fs.writeFileSync(LEADS_CACHE, JSON.stringify([...byIssue.values()], null, 1));
  } catch (error) {
    if (!fs.existsSync(LEADS_CACHE)) throw error;
    console.log(`Twenty unreachable (${String(error).slice(0, 80)}); using ${path.basename(LEADS_CACHE)}`);
    leads = JSON.parse(fs.readFileSync(LEADS_CACHE, "utf8"));
  }
  return issues.includes("all") ? leads : leads.filter((lead) => issues.includes(lead.issue));
}

async function loadLeadsFromTwenty() {
  if (CAMPAIGN === "3") return loadCampaign3Leads();
  if (CAMPAIGN === "4") return loadCampaign4Leads();
  const leads = [];
  let after = null;
  do {
    const data = await gql(`query {
      campaign2People(filter: { researchStatus: { eq: IN_RESEARCH } }, first: 100${after ? `, after: "${after}"` : ""}) {
        pageInfo { hasNextPage endCursor }
        edges { node { id name jobTitle companyName website location email emailType emailSource confidence cohort linearIssueUrl } }
      }
    }`);
    leads.push(...data.campaign2People.edges.map((edge) => edge.node));
    after = data.campaign2People.pageInfo.hasNextPage ? data.campaign2People.pageInfo.endCursor : null;
  } while (after);
  return leads.map((lead) => ({ ...lead, issue: lead.linearIssueUrl?.match(/BEE-\d+/)?.[0] })).filter((lead) => lead.issue);
}

// Campaign 3 has no Linear issues; a lead is keyed by its record id so result files stay stable across runs.
async function loadCampaign3Leads() {
  const data = await gql(`query {
    campaign3People(filter: { emailVerification: { eq: VALID }, cohort: { is: NOT_NULL } }, first: 300) {
      edges { node { id name jobTitle companyName website location email emailType emailSource cohort techStack linkedinUrl segment caseStudy } }
    }
  }`);
  return data.campaign3People.edges.map(({ node }) => ({ ...node, emailSource: node.emailSource === "CLODO_LOOKUP" ? "a people-data lookup, not published on the site" : node.emailSource, issue: "C3-" + node.id.slice(0, 8) }));
}

// Campaign 4 people hang off their organization; only ZeroBounce-verified contacts are researched.
async function loadCampaign4Leads() {
  const data = await gql(`query {
    campaign4People(filter: { researchStatus: { eq: VERIFIED } }, first: 300) {
      edges { node { id name jobTitle roleType email emailType emailSource linkedinUrl organization { name website city state source } } }
    }
  }`);
  return data.campaign4People.edges.map(({ node }) => ({
    id: node.id,
    name: node.name,
    jobTitle: node.jobTitle,
    companyName: node.organization?.name,
    website: node.organization?.website,
    location: [node.organization?.city, node.organization?.state].filter(Boolean).join(", "),
    email: node.email,
    emailType: node.emailType,
    emailSource: node.emailSource,
    linkedinUrl: node.linkedinUrl,
    segment: node.organization?.source,
    issue: "C4-" + node.id.slice(0, 8),
  }));
}

function prompt(lead) {
  return [
    `Today is ${new Date().toISOString().slice(0, 10)}. Collect evidence for the sales lead below by following the protocol exactly.`,
    ...(args.includes("--voice-focus") ? ["Spend most of your effort on the owner voice / social listening step: find at least 5 OWNER_VOICE items (podcasts, videos, interviews, articles, newsletters, talks, public posts) from the last 12 months, each on a page that loads without logging in."] : []),
    MODEL.startsWith("pi:")
      ? (args.includes("--search") ? `Use the perplexity_search tool to find the practice's real website, owner and pages when the site on file is wrong, dead or thin, and to look for pages the site does not link to. Then ` : `You have no web search tool: `) + `open pages with \`curl -sL -A "Mozilla/5.0" <url>\` and strip tags (e.g. pipe through sed) to read the visible text. Start from the website on file and follow its links (about, team, contact, FAQ, pricing, new patients). If curl shows little or no visible text (a JavaScript-built site), read the page with \`node ${path.join(__dirname, "render-page.mjs")} <url>\` instead. Use the terminal only for curl, that render command and to write gather.json.`
      : `Use your web search and page reading tools. Do not run terminal commands except to write gather.json.`,
    "",
    `Lead (${lead.issue}):`,
    `- Name on file: ${lead.name || "(none)"}`,
    `- Role on file: ${lead.jobTitle || "(none)"}`,
    `- Practice: ${lead.companyName || "(none)"}`,
    `- Website on file: ${lead.website || "(none)"}`,
    `- Location: ${lead.location || "(none)"}`,
    `- Email on file: ${lead.email || "(none)"} (${lead.emailType || "unknown type"}; found via ${lead.emailSource || "unknown"})`,
    ...(lead.techStack ? [`- Tools seen on their site (unverified): ${lead.techStack}`] : []),
    ...(lead.linkedinUrl ? [`- LinkedIn on file: ${lead.linkedinUrl}`] : []),
    ...(lead.segment ? [`- Segment: ${lead.segment}`] : []),
    "",
    PROTOCOL,
  ].join("\n");
}

function agentCommand(promptText, workDir) {
  if (MODEL === "codex") {
    return ["codex", ["--search", "exec", "-s", "workspace-write", "--skip-git-repo-check", "-C", workDir, promptText]];
  }
  if (MODEL.startsWith("pi:")) {
    // With --search, Pi gets only Perplexity's link-returning search tool; its answer/research tools would cost more per call.
    const searchTools = args.includes("--search") ? ["--tools", "read,bash,write,edit,mcp__perplexity__perplexity_search"] : ["--no-mcp"];
    return ["pi", ["-p", "--model", MODEL.slice("pi:".length), "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates", ...searchTools, "--mode", "json", promptText]];
  }
  if (MODEL.startsWith("gemini-cli")) {
    const model = MODEL.split(":")[1];
    return ["gemini", ["--skip-trust", "--approval-mode", "yolo", "--output-format", "json", ...(model ? ["-m", model] : []), "-p", promptText]];
  }
  if (MODEL.startsWith("claude-code:")) {
    return ["claude", ["-p", promptText, "--model", MODEL.slice("claude-code:".length), "--permission-mode", "bypassPermissions", "--allowedTools", "WebSearch,WebFetch,Read,Write", "--output-format", "json"]];
  }
  return ["agy", ["-p", promptText, "--model", MODEL, "--sandbox", "--dangerously-skip-permissions", "--output-format", "json", "--print-timeout", "1440s"]];
}

function geminiUsage(stdout) {
  try {
    const stats = JSON.parse(stdout.slice(stdout.indexOf("{"))).stats ?? {};
    const models = Object.fromEntries(Object.entries(stats.models ?? {}).map(([name, model]) => [name, { requests: model.api?.totalRequests, tokens: model.tokens }]));
    return { models, toolCalls: stats.tools?.totalCalls };
  } catch {
    return undefined;
  }
}

// Claude Code's JSON result carries cost and token counts, which lets us estimate subscription usage per lead.
function claudeUsage(stdout) {
  if (MODEL.startsWith("pi:")) return piUsage(stdout);
  if (MODEL.startsWith("gemini-cli")) return geminiUsage(stdout);
  if (!MODEL.startsWith("claude-code:")) return undefined;
  try {
    const result = JSON.parse(stdout.trim());
    return { costUsd: result.total_cost_usd, durationMs: result.duration_ms, turns: result.num_turns, usage: result.usage, modelUsage: result.modelUsage };
  } catch {
    return undefined;
  }
}

// Pi's JSON mode streams events; summing assistant message usage gives tokens and cost per lead.
function piUsage(stdout) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, turns: 0 };
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      const usage = event.type === "message_end" && event.message?.role === "assistant" ? event.message.usage : undefined;
      if (!usage) continue;
      total.turns += 1;
      total.input += usage.input ?? 0;
      total.output += usage.output ?? 0;
      total.cacheRead += usage.cacheRead ?? 0;
      total.cacheWrite += usage.cacheWrite ?? 0;
      total.costUsd += usage.cost?.total ?? 0;
    } catch {}
  }
  return total;
}

function runAgent(promptText, workDir, home) {
  return new Promise((resolve) => {
    const [command, commandArgs] = agentCommand(promptText, workDir);
    const child = spawn(command, commandArgs, { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], env: home ? { ...process.env, HOME: home } : process.env });
    let output = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), LEAD_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, tail: output.slice(-1500), usage: claudeUsage(stdout) });
    });
  });
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => ENTITIES[name.toLowerCase()] ?? entity);
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[ \s]+/g, " ")
    .trim();
}

const tokens = (text) => normalize(text).match(/[a-z0-9$%@.']+/g) ?? [];

// Share of the quote's words found in order in the best matching stretch of the page.
function closeness(quote, pageText) {
  const quoteTokens = tokens(quote);
  const pageTokens = tokens(pageText);
  if (!quoteTokens.length) return 0;
  let best = 0;
  for (let start = 0; start < pageTokens.length; start++) {
    if (pageTokens[start] !== quoteTokens[0] && pageTokens[start] !== quoteTokens[1]) continue;
    let matched = 0;
    let cursor = start;
    for (const token of quoteTokens) {
      const found = pageTokens.indexOf(token, cursor);
      if (found !== -1 && found - cursor <= 3) {
        matched++;
        cursor = found + 1;
      }
    }
    best = Math.max(best, matched / quoteTokens.length);
    if (best === 1) break;
  }
  return best;
}

let browserPromise;
async function renderedText(url) {
  const { chromium } = await import("playwright");
  // The repo's pinned Playwright browser is often not downloaded; the installed Chrome works the same here.
  browserPromise ??= chromium.launch({ channel: "chrome", headless: true });
  const browser = await browserPromise;
  const page = await browser.newPage({ userAgent: USER_AGENT });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    // Sites with chat widgets or trackers never go network-idle, so wait for the load event briefly, then settle.
    await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    const html = await page.content();
    return { status: response?.status() ?? 0, finalUrl: page.url(), text, html };
  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (browserPromise) await (await browserPromise.catch(() => null))?.close();
}

const pageCache = new Map();
async function loadPage(url, { render = false } = {}) {
  const key = (render ? "render:" : "fetch:") + url;
  if (pageCache.has(key)) return pageCache.get(key);
  let result;
  if (render) {
    result = await renderedText(url).catch((error) => ({ status: 0, error: String(error).slice(0, 200), text: "", html: "" }));
  } else {
    result = { status: 0, text: "", html: "" };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(20000) });
        const html = await res.text();
        result = { status: res.status, finalUrl: res.url, text: htmlToText(html), html };
        if (res.status < 500) break;
      } catch (error) {
        result.error = String(error).slice(0, 200);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  pageCache.set(key, result);
  return result;
}

// Agents often read the right text but record a guessed path (/faq, /work-with-me), so a miss on the cited URL is
// retried against the site's own pages before the item is thrown away.
const sitePagesCache = new Map();
async function sitePages(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return [];
  }
  if (sitePagesCache.has(origin)) return sitePagesCache.get(origin);
  const found = new Set([origin + "/"]);
  const readLocs = async (sitemapUrl) => {
    const page = await loadPage(sitemapUrl);
    return page.status === 200 ? [...page.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]) : [];
  };
  for (const sitemap of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    for (const loc of await readLocs(origin + sitemap)) {
      if (loc.endsWith(".xml")) (await readLocs(loc)).forEach((nested) => found.add(nested));
      else found.add(loc);
    }
  }
  const home = await loadPage(origin + "/");
  const host = new URL(origin).hostname.replace(/^www\./, "");
  for (const match of (home.html ?? "").matchAll(/href="([^"#?]+)"/g)) {
    try {
      const link = new URL(match[1], origin);
      if (link.hostname.replace(/^www\./, "") === host && !/\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml)$/i.test(link.pathname)) found.add(link.origin + link.pathname);
    } catch {}
  }
  const pages = [...found].filter((page) => !page.endsWith(".xml")).slice(0, 80);
  sitePagesCache.set(origin, pages);
  return pages;
}

async function findElsewhere(url, matches) {
  const sameSite = (candidate) => {
    try {
      return new URL(candidate).hostname.replace(/^www\./, "") === new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return false;
    }
  };
  // Pages the agent cited elsewhere in this lead are the likeliest home of a misattributed quote, so they go first.
  const candidates = [...new Set([...citedPages.filter(sameSite), ...(await sitePages(url))])].filter(
    (candidate) => candidate.replace(/\/$/, "") !== url.replace(/\/$/, ""),
  );
  for (const candidate of candidates) {
    const page = await loadPage(candidate);
    if (page.text && matches(page)) return candidate;
  }
  // JS-built sites (Squarespace, Wix) only show some text after rendering; cap it, a render costs seconds.
  for (const candidate of candidates.slice(0, 25)) {
    const page = await loadPage(candidate, { render: true });
    if (page.text && matches(page)) return candidate;
  }
  return null;
}

async function checkQuote(checkedItem) {
  const { check: _check, closeness: _closeness, httpStatus: _httpStatus, via: _via, citedStatus: _citedStatus, dateOnPage: _dateOnPage, ...item } = checkedItem ?? {};
  if (!item.url || !item.quote) return { ...item, check: "MISSING_URL_OR_QUOTE" };
  let lastStatus = 0;
  for (const render of [false, true]) {
    const page = await loadPage(item.url, { render });
    lastStatus = page.status || lastStatus;
    if (!page.text) continue;
    const pageText = normalize(page.text);
    const extra = {};
    if (item.dateShownOnPage) extra.dateOnPage = pageText.includes(normalize(item.dateShownOnPage));
    if (pageText.includes(normalize(item.quote))) return { ...item, check: "VERIFIED", httpStatus: page.status, via: render ? "render" : "fetch", ...extra };
    const score = closeness(item.quote, page.text);
    if (score >= 0.9) return { ...item, check: "CLOSE", closeness: Number(score.toFixed(2)), httpStatus: page.status, via: render ? "render" : "fetch", ...extra };
    if (render) {
      const foundAt = await findElsewhere(item.url, (other) => normalize(other.text).includes(normalize(item.quote)));
      if (foundAt) return { ...item, check: "RELOCATED", citedUrl: item.url, url: foundAt, citedStatus: page.status };
      return { ...item, check: page.status >= 400 ? "BROKEN_URL" : "NOT_ON_PAGE", closeness: Number(score.toFixed(2)), httpStatus: page.status, ...extra };
    }
  }
  return { ...item, check: "PAGE_FAILED", httpStatus: lastStatus };
}

async function checkEmail(email) {
  if (!email?.address) return email ? { ...email, check: "NONE_PUBLISHED" } : null;
  const address = email.address.toLowerCase();
  for (const render of [false, true]) {
    const page = await loadPage(email.url, { render });
    if (normalize(page.text).includes(address)) return { ...email, check: "VERIFIED", via: render ? "render" : "fetch" };
    if (page.html?.toLowerCase().includes("mailto:" + address)) return { ...email, check: "MAILTO_ONLY", via: render ? "render" : "fetch" };
  }
  const foundAt = await findElsewhere(email.url, (page) => normalize(page.text).includes(address));
  if (foundAt) return { ...email, check: "RELOCATED", citedUrl: email.url, url: foundAt };
  return { ...email, check: "NOT_ON_PAGE" };
}

// Practices rarely name their EHR or booking tool in visible text; a link to the tool's domain in the page is proof enough.
async function checkTool(tool) {
  const checked = await checkQuote(tool);
  if (["VERIFIED", "CLOSE", "RELOCATED"].includes(checked.check) || !tool?.url || !tool?.quote) return checked;
  for (const render of [false, true]) {
    const page = await loadPage(tool.url, { render });
    if (page.html?.toLowerCase().includes(tool.quote.toLowerCase())) return { ...checked, check: "IN_PAGE_SOURCE", via: render ? "render" : "fetch" };
  }
  return checked;
}

let citedPages = [];
async function check(gathered) {
  citedPages = [...new Set([...(gathered.owner?.evidence ?? []), ...(gathered.fit?.evidence ?? []), ...(gathered.hooks ?? []), gathered.email ?? {}].map((item) => item.url).filter(Boolean))];
  const owner = { ...gathered.owner, evidence: await Promise.all((gathered.owner?.evidence ?? []).map(checkQuote)) };
  const fit = { ...gathered.fit, evidence: await Promise.all((gathered.fit?.evidence ?? []).map(checkQuote)) };
  const hooks = [];
  for (const hook of gathered.hooks ?? []) hooks.push(await checkQuote(hook));
  const email = await checkEmail(gathered.email);
  // Agents sometimes return tools as an object keyed by tool name instead of a list.
  const toolList = Array.isArray(gathered.tools)
    ? gathered.tools
    : gathered.tools && typeof gathered.tools === "object"
      ? Object.entries(gathered.tools).map(([name, value]) => (value && typeof value === "object" ? { name, ...value } : { name, quote: String(value) }))
      : null;
  const tools = toolList ? await Promise.all(toolList.filter((tool) => tool && typeof tool === "object").map(checkTool)) : undefined;
  const items = [...owner.evidence, ...fit.evidence, ...hooks];
  const passed = (item) => ["VERIFIED", "CLOSE", "RELOCATED"].includes(item.check);
  return {
    ...gathered,
    owner,
    fit,
    hooks,
    email,
    ...(tools ? { tools } : {}),
    checkSummary: {
      items: items.length,
      verified: items.filter((item) => item.check === "VERIFIED").length,
      close: items.filter((item) => item.check === "CLOSE").length,
      relocated: items.filter((item) => item.check === "RELOCATED").length,
      notOnPage: items.filter((item) => item.check === "NOT_ON_PAGE").length,
      brokenUrl: items.filter((item) => item.check === "BROKEN_URL").length,
      pageFailed: items.filter((item) => item.check === "PAGE_FAILED").length,
      usableHooks: hooks.filter(passed).length,
      ...(tools ? { usableTools: tools.filter((tool) => passed(tool) || tool.check === "IN_PAGE_SOURCE").length } : {}),
      ownerSupported: owner.evidence.some(passed),
      fitSupported: fit.evidence.some(passed),
      email: email?.check ?? "NONE",
    },
  };
}

// Perplexity's Sonar models search the web server-side in a single API call, so there is no agent loop or file to write:
// the JSON comes back in the reply and is saved as gather.json for the same check as every other tool.
async function perplexityGather(lead, workDir) {
  const promptText = prompt(lead)
    .replace(/Use your web search and page reading tools\.[^\n]*/, "Search the web and read the practice's own pages (about, team, contact, FAQ, pricing, new patients). Quote only text you found on those pages.")
    .replace(/Write a file named `gather\.json`[^\n]*/, "Reply with only the JSON object below, filled in, inside one ```json code block. No other text.");
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.PERPLEXITY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL.slice("perplexity:".length),
        messages: [{ role: "user", content: promptText }],
        web_search_options: { search_context_size: "high" },
        // Restricting search to the practice's own domain pushes its FAQ, policy and new-patient pages into the results.
        ...(args.includes("--site-only") && lead.website ? { search_domain_filter: [new URL(/^https?:/.test(lead.website) ? lead.website : "https://" + lead.website).hostname.replace(/^www\./, "")] } : {}),
      }),
      signal: AbortSignal.timeout(LEAD_TIMEOUT_MS),
    });
    const json = await res.json();
    if (!res.ok) return { code: res.status, tail: JSON.stringify(json).slice(0, 1500) };
    const content = (json.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
    const block = content.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
    fs.writeFileSync(path.join(workDir, "gather.json"), block);
    return { code: 0, tail: content.slice(-1500), usage: { costUsd: json.usage?.cost?.total_cost, usage: json.usage, citations: json.citations?.length ?? json.search_results?.length } };
  } catch (error) {
    return { code: 1, tail: String(error) };
  }
}

async function gatherLead(lead, home) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `c${CAMPAIGN}-gather-${lead.issue}-`));
  const startedAt = new Date().toISOString();
  const { code, tail, usage } = MODEL.startsWith("perplexity:") ? await perplexityGather(lead, workDir) : await runAgent(prompt(lead), workDir, home);
  const file = path.join(workDir, "gather.json");
  const base = { issue: lead.issue, [`campaign${CAMPAIGN}PersonId`]: lead.id, cohort: lead.cohort, practice: lead.companyName, nameOnFile: lead.name, model: MODEL, startedAt, finishedAt: new Date().toISOString(), exitCode: code, workDir, ...(usage ? { agentUsage: usage } : {}) };
  if (!fs.existsSync(file)) return { ...base, error: (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(tail) ? "QUOTA: " : "NO_OUTPUT: ") + tail.slice(-300) };
  let gathered;
  try {
    gathered = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ...base, error: "BAD_JSON: " + String(error).slice(0, 200) };
  }
  return { ...base, ...(await check(gathered)) };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

if (option("--recheck")) {
  const file = path.join(OUT_DIR, option("--recheck") + ".json");
  const existing = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...existing, ...(await check(existing)) }, null, 1));
  console.log(JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8")).checkSummary));
  await closeBrowser();
  process.exit(0);
}

const issues = option("--only")?.split(",") ?? [];
if (!issues.length) throw new Error("Pass --only BEE-1,BEE-2 (or --only all for Campaign 3)");
const finished = (issue) => {
  const file = path.join(OUT_DIR, issue + ".json");
  return fs.existsSync(file) && !JSON.parse(fs.readFileSync(file, "utf8")).error;
};
const queue = (await loadLeads(issues)).filter((lead) => !finished(lead.issue));
console.log(`${new Date().toISOString()} gathering ${queue.length} leads with ${MODEL} x${CONCURRENCY}`);

// A spent quota fails every later call within seconds, so stop instead of marking the rest of the queue as errors.
let quotaStrikes = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async (_, workerIndex) => {
  const home = AGY_HOMES[workerIndex % AGY_HOMES.length];
  while (queue.length && quotaStrikes < 3) {
    const lead = queue.shift();
    // Several runs can share a lead list; the lock and the finished check keep two of them off the same lead.
    const lockFile = path.join(OUT_DIR, lead.issue + ".lock");
    if (finished(lead.issue)) continue;
    try {
      fs.writeFileSync(lockFile, `${process.pid} ${MODEL}`, { flag: "wx" });
    } catch {
      const ownerPid = Number(fs.readFileSync(lockFile, "utf8").split(" ")[0]);
      let alive = false;
      try {
        process.kill(ownerPid, 0);
        alive = true;
      } catch {}
      if (alive) continue;
      fs.writeFileSync(lockFile, `${process.pid} ${MODEL}`);
    }
    const result = await gatherLead(lead, home).finally(() => fs.rmSync(lockFile, { force: true }));
    if (home && AGY_HOMES.length > 1 && result.error?.startsWith("QUOTA")) {
      console.log(`${result.finishedAt} ${lead.issue} QUOTA on ${path.basename(home)}; handing the lead back and stopping that worker`);
      queue.push(lead);
      break;
    }
    fs.writeFileSync(path.join(OUT_DIR, lead.issue + ".json"), JSON.stringify(result, null, 1));
    console.log(`${result.finishedAt} ${lead.issue}${home ? " [" + path.basename(home) + "]" : ""} ${result.error ? result.error.split(":")[0] : "OK " + JSON.stringify(result.checkSummary)}`);
    quotaStrikes = result.error?.startsWith("QUOTA") ? quotaStrikes + 1 : 0;
  }
}));
if (quotaStrikes >= 3) console.log(`stopped after 3 quota errors in a row; ${queue.length} leads left in the queue`);
await closeBrowser();
