// Researches Campaign 2 leads still IN_RESEARCH in Twenty by fanning them out to several agent CLIs
// (Antigravity Gemini 3.8 Flash, Antigravity Opus 4.6, Codex) pulling from one shared queue. Each lead gets the
// protocol in campaign2-research-protocol.md and writes comment1.md (lead research) and comment2.md (social
// listening). Results land in artifacts/campaign-2-leads/research-runs/<BEE-n>.json; rerunning skips finished leads.
// Output is unverified until Claude checks it.
// Usage: node scripts/campaign2-research-runner.mjs [--tools gemini,opus,codex] [--only BEE-1,BEE-2] [--limit N]
//        [--concurrency gemini=8,opus=4,codex=4] [--dry-run]

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
const OUT_DIR = path.join(__dirname, "..", "artifacts", "campaign-2-leads", "research-runs");
const PROTOCOL = fs.readFileSync(path.join(__dirname, "campaign2-research-protocol.md"), "utf8");
const LEAD_TIMEOUT_MS = 25 * 60 * 1000;
const QUOTA_PATTERN = /RESOURCE_EXHAUSTED|exhausted your capacity|quota|rate limit|usage limit|429/i;

const TOOLS = {
  gemini: { concurrency: 4, model: "gemini-3.8-flash-high", command: agyCommand("gemini-3.8-flash-high") },
  geminimedium: { concurrency: 4, model: "gemini-3.8-flash-medium", command: agyCommand("gemini-3.8-flash-medium") },
  geminilow: { concurrency: 4, model: "gemini-3.8-flash-low", command: agyCommand("gemini-3.8-flash-low") },
  opus: { concurrency: 4, model: "claude-opus-4-6-thinking", command: agyCommand("claude-opus-4-6-thinking") },
  sonnet: { concurrency: 4, model: "claude-sonnet-4-6", command: agyCommand("claude-sonnet-4-6") },
  gptoss: { concurrency: 4, model: "gpt-oss-120b-medium", command: agyCommand("gpt-oss-120b-medium") },
  codex: {
    concurrency: 4,
    model: "codex default",
    command: (prompt, workDir) => [
      "codex",
      ["--search", "exec", "-s", "workspace-write", "--skip-git-repo-check", "-C", workDir, "-o", path.join(workDir, "last-message.md"), prompt],
    ],
  },
};

function agyCommand(model) {
  return (prompt) => [
    "agy",
    ["-p", prompt, "--model", model, "--sandbox", "--dangerously-skip-permissions", "--output-format", "json", "--print-timeout", "1440s"],
  ];
}

const selectedTools = (option("--tools") ?? "gemini,opus,codex").split(",");
for (const pair of (option("--concurrency") ?? "").split(",").filter(Boolean)) {
  const [tool, count] = pair.split("=");
  TOOLS[tool].concurrency = Number(count);
}

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

async function loadLeads() {
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
  return leads
    .map((lead) => ({ ...lead, issue: lead.linearIssueUrl?.match(/BEE-\d+/)?.[0] }))
    .filter((lead) => lead.issue)
    .sort((a, b) => a.cohort.localeCompare(b.cohort) || Number(a.issue.slice(4)) - Number(b.issue.slice(4)));
}

function leadCard(lead) {
  return [
    `Lead (Linear ${lead.issue}, ${lead.cohort}):`,
    `- Name on file: ${lead.name || "(none)"}`,
    `- Role on file: ${lead.jobTitle || "(none)"}`,
    `- Practice: ${lead.companyName || "(none)"}`,
    `- Website: ${lead.website || "(none)"}`,
    `- Location: ${lead.location || "(none)"}`,
    `- Email on file: ${lead.email || "(none)"} (${lead.emailType || "unknown type"})`,
    `- How the email was found: ${lead.emailSource || "(unknown)"}`,
    `- Owner confidence: ${lead.confidence || "(unknown)"}`,
    lead.cohort === "C2_COHORT_1" ? "- A previous research attempt on this lead failed verification. Be extra careful with identity and references." : "",
  ].filter(Boolean).join("\n");
}

function prompt(lead) {
  return [
    `Today is ${new Date().toISOString().slice(0, 10)}. Research the sales lead below by following the protocol exactly.`,
    `Use your web search and page reading tools. Do not run terminal commands except to write the two output files.`,
    `When done, write your two deliverables as files in the current working directory: comment1.md and comment2.md, each complete and self-contained with its own References section. Then reply with only the word DONE.`,
    "",
    leadCard(lead),
    "",
    PROTOCOL,
  ].join("\n");
}

function runCommand(command, commandArgs, workDir) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: workDir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), LEAD_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function readIfPresent(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
}

async function research(lead, toolName) {
  const tool = TOOLS[toolName];
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `c2-research-${lead.issue}-`));
  const startedAt = new Date().toISOString();
  const [command, commandArgs] = tool.command(prompt(lead), workDir);
  const { code, stdout, stderr } = await runCommand(command, commandArgs, workDir);
  const comment1 = readIfPresent(path.join(workDir, "comment1.md"));
  const comment2 = readIfPresent(path.join(workDir, "comment2.md"));
  const ok = comment1.length > 200 && comment2.length > 0;
  const tail = (stdout + "\n" + stderr).slice(-2000);
  return {
    issue: lead.issue,
    campaign2PersonId: lead.id,
    cohort: lead.cohort,
    practice: lead.companyName,
    tool: toolName,
    model: tool.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: code,
    comment1,
    comment2,
    error: ok ? undefined : QUOTA_PATTERN.test(tail) ? "QUOTA: " + tail.slice(-300) : "NO_OUTPUT: " + tail.slice(-300),
    workDir,
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const lockName of fs.readdirSync(OUT_DIR).filter((file) => file.endsWith(".lock"))) {
  const ownerPid = Number(fs.readFileSync(path.join(OUT_DIR, lockName), "utf8").split(" ")[0]);
  let alive = false;
  try {
    process.kill(ownerPid, 0);
    alive = true;
  } catch {}
  if (!alive) fs.rmSync(path.join(OUT_DIR, lockName), { force: true });
}
const only = option("--only")?.split(",");
const finished = (lead) => {
  const file = path.join(OUT_DIR, lead.issue + ".json");
  return fs.existsSync(file) && !JSON.parse(fs.readFileSync(file, "utf8")).error;
};
const queue = (await loadLeads())
  .filter((lead) => !only || only.includes(lead.issue))
  .filter((lead) => !finished(lead))
  .slice(0, Number(option("--limit") ?? Infinity));

console.log(`${new Date().toISOString()} leads to research: ${queue.length}; tools: ${selectedTools.map((t) => `${t}x${TOOLS[t].concurrency}`).join(", ")}`);
if (args.includes("--dry-run")) {
  console.log(queue.map((lead) => `${lead.issue} ${lead.cohort} ${lead.companyName}`).join("\n"));
  process.exit(0);
}

const stoppedTools = new Set();
const quotaStrikes = {};
const tally = {};
await Promise.all(selectedTools.flatMap((toolName) =>
  Array.from({ length: TOOLS[toolName].concurrency }, async () => {
    while (queue.length && !stoppedTools.has(toolName)) {
      const lead = queue.shift();
      // Several runner processes can share the queue; the lock file stops two of them taking the same lead.
      const lockFile = path.join(OUT_DIR, lead.issue + ".lock");
      if (finished(lead)) continue;
      try {
        fs.writeFileSync(lockFile, `${process.pid} ${toolName} ${new Date().toISOString()}`, { flag: "wx" });
      } catch {
        continue;
      }
      const result = await research(lead, toolName);
      fs.writeFileSync(path.join(OUT_DIR, lead.issue + ".json"), JSON.stringify(result, null, 1));
      fs.rmSync(lockFile, { force: true });
      const outcome = result.error ? result.error.split(":")[0] : "OK";
      tally[`${toolName}:${outcome}`] = (tally[`${toolName}:${outcome}`] || 0) + 1;
      console.log(`${result.finishedAt} ${lead.issue} ${toolName} ${outcome} (${queue.length} queued)`);
      // A spent quota fails every call for hours; hand the lead back and let the other tools carry on.
      if (outcome === "QUOTA") {
        fs.rmSync(path.join(OUT_DIR, lead.issue + ".json"), { force: true });
        queue.unshift(lead);
        // One 429 is often a burst limit. Stop the tool only after three in a row.
        quotaStrikes[toolName] = (quotaStrikes[toolName] || 0) + 1;
        if (quotaStrikes[toolName] >= 3) {
          stoppedTools.add(toolName);
          console.log(`${toolName} hit its quota 3 times; stopping its workers.`);
        } else {
          console.log(`${toolName} quota ${quotaStrikes[toolName]}/3; lead returned to the queue.`);
        }
      } else {
        quotaStrikes[toolName] = 0;
      }
    }
  }),
));
console.log("tally:", tally, "left in queue:", queue.length);
