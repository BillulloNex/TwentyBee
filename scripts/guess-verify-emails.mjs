// Finds a person's work email by guessing common address patterns on the practice domain, checking each guess
// with the self-hosted Reacher (free) until one is "safe", then confirming that one with ZeroBounce (1 credit).
// Only a ZeroBounce-valid guess counts as found; catch-all domains cannot be verified this way and are reported.
// Reacher results are cached in artifacts/reacher-cache.json and ZeroBounce results in artifacts/zerobounce-cache.json.
// Input: JSON array of { key, name, domain }. Output: <input>-guesses.json keyed by key.
// When the Cloudflare tunnel is down: REACHER_URL=http://100.77.63.10 REACHER_HOST=reacher.beenex.org
// --zerobounce-direct: second pass for people left at CATCH_ALL, NOT_FOUND or UNVERIFIABLE; asks ZeroBounce directly
// about the two most common shapes (first@, then flast@), which it can often confirm where Reacher cannot.
// Usage: node scripts/guess-verify-emails.mjs --file <people.json> [--no-zerobounce] [--zerobounce-direct]

import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const INPUT = option("--file");
const OUTPUT = INPUT.replace(/\.json$/, "-guesses.json");
const USE_ZEROBOUNCE = !args.includes("--no-zerobounce");
const ZEROBOUNCE_DIRECT = args.includes("--zerobounce-direct");
const ARTIFACTS = path.join(__dirname, "..", "artifacts");
const REACHER_CACHE = path.join(ARTIFACTS, "reacher-cache.json");
const ZEROBOUNCE_CACHE = path.join(ARTIFACTS, "zerobounce-cache.json");
const REACHER_URL = new URL("/v0/check_email", process.env.REACHER_URL || "http://reacher.beenex.org");
const ZEROBOUNCE_KEYS = [...new Set([process.env.ZEROBOUNCE_API_KEY, ...(process.env.ZEROBOUNCE_API_KEYS || "").split(",")].map((key) => key?.trim()).filter(Boolean))];

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const reacherCache = readJson(REACHER_CACHE);
const zerobounceCache = readJson(ZEROBOUNCE_CACHE);
const results = readJson(OUTPUT);

const CREDENTIALS = /\b(dr|md|do|nd|dc|np|fnp|aprn|pa|pac|rn|bsn|msn|phd|lac|dacm|ifmcp|dnp|lmhc|lcsw|jr|sr|ii|iii|mba|mph|abihm|faafp)\b\.?/gi;
function nameParts(name) {
  const cleaned = name.replace(/\(.*?\)/g, " ").replace(/,.*$/, "").replace(CREDENTIALS, " ").replace(/[^A-Za-z\s'-]/g, " ").trim().toLowerCase();
  const parts = cleaned.split(/\s+/).filter(Boolean).map((part) => part.replace(/['-]/g, ""));
  return { first: parts[0] || "", last: parts.length > 1 ? parts.at(-1) : "" };
}

// Ordered by how often each shape appears in small-practice addresses we have already verified.
function patterns(name) {
  const { first, last } = nameParts(name);
  if (!first) return [];
  const list = [first];
  if (last) {
    list.push(`${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `dr${last}`, `${first[0]}.${last}`, last, `${first}${last[0]}`, `dr.${last}`, `${first}_${last}`, `dr${first}`);
  }
  return [...new Set(list)];
}

function reacherPost(email) {
  return new Promise((resolve, reject) => {
    const client = REACHER_URL.protocol === "https:" ? https : http;
    const req = client.request(
      REACHER_URL,
      {
        method: "POST",
        timeout: 90000,
        headers: { "Content-Type": "application/json", "x-reacher-secret": process.env.REACHER_SECRET, ...(process.env.REACHER_HOST ? { Host: process.env.REACHER_HOST } : {}) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => (res.statusCode === 200 ? resolve(JSON.parse(data)) : reject(new Error(`Reacher ${res.statusCode}`))));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(JSON.stringify({ to_email: email }));
  });
}

async function reacher(email) {
  if (reacherCache[email]) return reacherCache[email];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await reacherPost(email);
      const flags = [];
      if (result.smtp?.is_catch_all) flags.push("catch_all");
      if (result.misc?.is_role_account) flags.push("role_account");
      if (!result.mx?.accepts_mail) flags.push("no_mx");
      reacherCache[email] = { result: result.is_reachable, detail: flags.join(","), error: result.smtp?.error?.message || null, checkedAt: new Date().toISOString() };
      fs.writeFileSync(REACHER_CACHE, JSON.stringify(reacherCache, null, 2));
      return reacherCache[email];
    } catch (error) {
      if (attempt === 2) return { result: "failed", detail: String(error.message) };
    }
  }
}

let keyIndex = 0;
async function zerobounce(email) {
  if (zerobounceCache[email]) return zerobounceCache[email];
  while (keyIndex < ZEROBOUNCE_KEYS.length) {
    const res = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${ZEROBOUNCE_KEYS[keyIndex]}&email=${encodeURIComponent(email)}&ip_address=`);
    const data = await res.json();
    if (data.error || data.status === undefined) {
      keyIndex++;
      continue;
    }
    zerobounceCache[email] = { status: data.status, subStatus: data.sub_status || null, provider: data.smtp_provider || null, checkedAt: new Date().toISOString() };
    fs.writeFileSync(ZEROBOUNCE_CACHE, JSON.stringify(zerobounceCache, null, 2));
    return zerobounceCache[email];
  }
  return null;
}

async function find(person) {
  const domain = (person.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!domain) return { status: "NO_DOMAIN" };
  const guesses = patterns(person.name).map((local) => `${local}@${domain}`);
  if (!guesses.length) return { status: "NO_NAME" };
  // A made-up address tells us whether the server accepts everything, before spending checks on real guesses.
  const probe = await reacher(`zq${Date.now().toString(36).slice(-5)}x.nobody@${domain}`);
  if (probe.detail?.includes("no_mx")) return { status: "NO_MX", checks: 1 };
  if (probe.result === "risky" && probe.detail?.includes("catch_all")) return { status: "CATCH_ALL", checks: 1 };
  let checks = 1;
  const tried = [];
  for (const guess of guesses) {
    const check = await reacher(guess);
    checks++;
    tried.push(`${guess}:${check.result}`);
    if (check.result !== "safe") continue;
    if (!USE_ZEROBOUNCE) return { status: "REACHER_SAFE", email: guess, checks, tried };
    const confirmed = await zerobounce(guess);
    if (confirmed?.status === "valid") return { status: "FOUND", email: guess, checks, tried };
    tried.push(`${guess}:zerobounce-${confirmed?.status || "no credits"}`);
  }
  const unknowns = tried.filter((entry) => /:(unknown|failed)$/.test(entry)).length;
  return { status: unknowns === guesses.length ? "UNVERIFIABLE" : "NOT_FOUND", checks, tried };
}

async function zerobounceDirect(person, previous) {
  const domain = (person.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const { first, last } = nameParts(person.name);
  const guesses = [first, last ? `${first[0]}${last}` : null].filter(Boolean).map((local) => `${local}@${domain}`);
  const tried = [];
  for (const guess of guesses) {
    const confirmed = await zerobounce(guess);
    tried.push(`${guess}:zerobounce-${confirmed?.status || "no credits"}`);
    if (confirmed?.status === "valid") return { ...previous, status: "FOUND_ZEROBOUNCE", email: guess, firstPass: previous.status, tried: [...(previous.tried || []), ...tried] };
  }
  return { ...previous, status: previous.status, zerobounceDirect: tried };
}

const people = JSON.parse(fs.readFileSync(INPUT, "utf8"));
if (ZEROBOUNCE_DIRECT) {
  const retry = people.filter((person) => ["CATCH_ALL", "NOT_FOUND", "UNVERIFIABLE"].includes(results[person.key]?.status) && !results[person.key].zerobounceDirect);
  console.log(`${retry.length} people for the direct ZeroBounce pass`);
  for (const person of retry) {
    results[person.key] = await zerobounceDirect(person, results[person.key]);
    fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
    console.log(`${person.key} ${person.name}: ${results[person.key].status} ${results[person.key].email || ""}`);
  }
}
const queue = people.filter((person) => !results[person.key]);
console.log(`${people.length} people, ${queue.length} to guess`);
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const person = queue.shift();
      results[person.key] = { name: person.name, domain: person.domain, ...(await find(person)) };
      fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
      console.log(`${person.key} ${person.name} @ ${person.domain}: ${results[person.key].status} ${results[person.key].email || ""}`);
    }
  }),
);
const counts = Object.values(results).reduce((map, result) => ((map[result.status] = (map[result.status] || 0) + 1), map), {});
console.log("results", counts);
