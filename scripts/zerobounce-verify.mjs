// Verifies email addresses with ZeroBounce (ZEROBOUNCE_API_KEY in scripts/.env; free tier is 100 checks a
// month) and caches results in artifacts/zerobounce-cache.json so an address is never paid for twice.
// Stops before the account drops below --keep credits.
// Usage: node scripts/zerobounce-verify.mjs [--keep 5] email1 email2 ...   or   --file <json array of emails>

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const KEY = process.env.ZEROBOUNCE_API_KEY;
const CACHE = path.join(__dirname, "..", "artifacts", "zerobounce-cache.json");
const args = process.argv.slice(2);
const keep = args.includes("--keep") ? Number(args[args.indexOf("--keep") + 1]) : 5;
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
const emails = (fileArg ? JSON.parse(fs.readFileSync(fileArg, "utf8")) : args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--keep"))
  .map((email) => email.toLowerCase().trim())
  .filter(Boolean);

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const credits = async () => Number((await (await fetch(`https://api.zerobounce.net/v2/getcredits?api_key=${KEY}`)).json()).Credits);

let remaining = await credits();
for (const email of [...new Set(emails)]) {
  if (cache[email]) continue;
  if (remaining <= keep) {
    console.log(`stopping: ${remaining} credits left (keeping ${keep})`);
    break;
  }
  const res = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${KEY}&email=${encodeURIComponent(email)}&ip_address=`);
  const data = await res.json();
  if (data.error) {
    console.log(`${email}: error ${data.error}`);
    break;
  }
  cache[email] = { status: data.status, subStatus: data.sub_status || null, provider: data.smtp_provider || null, checkedAt: new Date().toISOString() };
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  remaining--;
  console.log(`${email}: ${data.status}${data.sub_status ? " / " + data.sub_status : ""}`);
}
console.log(`credits left: ${await credits()}`);
