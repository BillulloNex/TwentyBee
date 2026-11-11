// Checks email addresses with the self-hosted Reacher and caches results in artifacts/reacher-cache.json
// so reruns only check new addresses. Reacher is throttled at 60 requests a minute.
// When the Cloudflare tunnel is down, reach the box over Tailscale:
//   REACHER_URL=http://100.77.63.10 REACHER_HOST=reacher.beenex.org node scripts/reacher-verify.mjs ...
// Usage: node scripts/reacher-verify.mjs email1 email2 ...   or   --file <json array of emails>

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
const REACHER_URL = new URL("/v0/check_email", process.env.REACHER_URL || "http://reacher.beenex.org");
const CACHE = path.join(__dirname, "..", "artifacts", "reacher-cache.json");
const args = process.argv.slice(2);
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
const emails = (fileArg ? JSON.parse(fs.readFileSync(fileArg, "utf8")) : args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--file"))
  .map((email) => email.toLowerCase().trim())
  .filter((email) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email));

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const pending = [...new Set(emails)].filter((email) => !cache[email]);
console.log(`${new Set(emails).size} emails, ${pending.length} to check`);

// fetch() drops a custom Host header, which the Tailscale route needs.
function post(body) {
  return new Promise((resolve, reject) => {
    const client = REACHER_URL.protocol === "https:" ? https : http;
    const req = client.request(
      REACHER_URL,
      {
        method: "POST",
        timeout: 90000,
        headers: {
          "Content-Type": "application/json",
          "x-reacher-secret": process.env.REACHER_SECRET,
          ...(process.env.REACHER_HOST ? { Host: process.env.REACHER_HOST } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => (res.statusCode === 200 ? resolve(JSON.parse(data)) : reject(new Error(`Reacher ${res.statusCode}`))));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function check(email) {
  const result = await post({ to_email: email });
  const flags = [];
  if (result.smtp?.is_catch_all) flags.push("catch_all");
  if (result.misc?.is_role_account) flags.push("role_account");
  if (result.smtp?.is_disabled) flags.push("disabled");
  if (result.smtp?.has_full_inbox) flags.push("full_inbox");
  if (!result.mx?.accepts_mail) flags.push("no_mx");
  return { result: result.is_reachable, detail: flags.join(","), error: result.smtp?.error?.message || null, checkedAt: new Date().toISOString() };
}

let done = 0;
const queue = [...pending];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const email = queue.shift();
      const started = Date.now();
      try {
        cache[email] = await check(email);
      } catch (error) {
        console.log(`${email}: ${error.message}`);
      }
      if (++done % 20 === 0) {
        fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
        console.log(`${done}/${pending.length}`);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 4000 - (Date.now() - started))));
    }
  }),
);
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
const counts = [...new Set(emails)].reduce((map, email) => {
  const result = cache[email]?.result || "failed";
  map[result] = (map[result] || 0) + 1;
  return map;
}, {});
console.log("results", counts);
