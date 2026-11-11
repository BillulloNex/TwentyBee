// Verifies email addresses with ZeroBounce and caches results in artifacts/zerobounce-cache.json so an
// address is never paid for twice. Rotates through ZEROBOUNCE_API_KEY and the comma-separated
// ZEROBOUNCE_API_KEYS (free accounts, 100 checks a month each), leaving --keep credits on every key.
// Usage: node scripts/zerobounce-verify.mjs [--keep 5] email1 email2 ...   or   --file <json array of emails>

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const KEYS = [...new Set([process.env.ZEROBOUNCE_API_KEY, ...(process.env.ZEROBOUNCE_API_KEYS || "").split(",")].map((key) => key?.trim()).filter(Boolean))];
const CACHE = path.join(__dirname, "..", "artifacts", "zerobounce-cache.json");
const args = process.argv.slice(2);
const keep = args.includes("--keep") ? Number(args[args.indexOf("--keep") + 1]) : 5;
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
const emails = (fileArg ? JSON.parse(fs.readFileSync(fileArg, "utf8")) : args.filter((arg, index) => !arg.startsWith("--") && !["--keep", "--file"].includes(args[index - 1])))
  .map((email) => email.toLowerCase().trim())
  .filter(Boolean);

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const credits = async (key) => Number((await (await fetch(`https://api.zerobounce.net/v2/getcredits?api_key=${key}`)).json()).Credits);

const balances = [];
for (const key of KEYS) balances.push({ key, remaining: await credits(key) });
const usable = () => balances.find((balance) => balance.remaining > keep);

for (const email of [...new Set(emails)]) {
  if (cache[email]) continue;
  const balance = usable();
  if (!balance) {
    console.log(`stopping: every key is at or below ${keep} credits`);
    break;
  }
  const res = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${balance.key}&email=${encodeURIComponent(email)}&ip_address=`);
  const data = await res.json();
  if (data.error) {
    console.log(`${email}: error ${data.error}`);
    balance.remaining = 0;
    continue;
  }
  cache[email] = { status: data.status, subStatus: data.sub_status || null, provider: data.smtp_provider || null, checkedAt: new Date().toISOString() };
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  balance.remaining--;
  console.log(`${email}: ${data.status}${data.sub_status ? " / " + data.sub_status : ""}`);
}
const left = [];
for (const { key } of balances) left.push(await credits(key));
console.log(`credits left per key: ${left.join(", ")} (total ${left.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)})`);
