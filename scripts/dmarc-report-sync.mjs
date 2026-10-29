// Pulls DMARC aggregate reports (rua) out of Gmail over IMAP, parses the XML, and prints a per-domain
// health summary. Rows are cached in artifacts/dmarc/records.json so reruns only add new reports.
// Needs GMAIL_IMAP_USER and GMAIL_IMAP_APP_PASSWORD (a Google app password) in scripts/.env.
// Usage: node scripts/dmarc-report-sync.mjs [--days 14] [--email]   (--email sends the new reports via Resend)
//        node scripts/dmarc-report-sync.mjs --file report.xml.gz [--file other.zip]   (offline, no Gmail)

import fs from "fs";
import path from "path";
import zlib from "zlib";
import dns from "dns/promises";
import { fileURLToPath } from "url";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { ImapFlow } from "imapflow";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const args = process.argv.slice(2);
const argValues = (flag) => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));
const DAYS = Number(argValues("--days")[0] || 14);
const FILES = argValues("--file");
const STORE_PATH = path.join(__dirname, "..", "artifacts", "dmarc", "records.json");

// Below this share of DMARC-passing mail on a domain we flag it; one-off forwarders keep it from being 100%.
const PASS_RATE_ALERT = 0.98;

const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
const asArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

// Senders mislabel extensions, so sniff magic bytes instead of trusting the filename.
function unpack(filename, buffer) {
  try {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      return new AdmZip(buffer)
        .getEntries()
        .filter((entry) => entry.entryName.toLowerCase().endsWith(".xml"))
        .map((entry) => entry.getData().toString("utf8"));
    }
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) return [zlib.gunzipSync(buffer).toString("utf8")];
    if (buffer.toString("utf8", 0, 200).includes("<")) return [buffer.toString("utf8")];
  } catch (error) {
    console.warn(`skipped ${filename}: ${error.message}`);
    return [];
  }
  console.warn(`skipped ${filename}: unrecognized format (${buffer.subarray(0, 8).toString("hex")}, ${buffer.length} bytes)`);
  return [];
}

function parseReport(xml) {
  const feedback = xmlParser.parse(xml).feedback;
  if (!feedback) return [];
  const metadata = feedback.report_metadata;
  const policy = feedback.policy_published;
  return asArray(feedback.record).map((record) => {
    const evaluated = record.row.policy_evaluated;
    const dkimResults = asArray(record.auth_results?.dkim);
    const spfResults = asArray(record.auth_results?.spf);
    return {
      reportId: `${metadata.org_name}:${metadata.report_id}`,
      org: metadata.org_name,
      begin: new Date(Number(metadata.date_range.begin) * 1000).toISOString(),
      end: new Date(Number(metadata.date_range.end) * 1000).toISOString(),
      policyDomain: policy.domain,
      policy: policy.p,
      headerFrom: record.identifiers?.header_from,
      sourceIp: record.row.source_ip,
      count: Number(record.row.count),
      disposition: evaluated.disposition,
      dkimAligned: evaluated.dkim,
      spfAligned: evaluated.spf,
      dkimDomains: dkimResults.map((dkim) => `${dkim.domain}=${dkim.result}`).join(", "),
      spfDomains: spfResults.map((spf) => `${spf.domain}=${spf.result}`).join(", "),
    };
  });
}

async function fetchFromGmail() {
  const user = process.env.GMAIL_IMAP_USER;
  const pass = process.env.GMAIL_IMAP_APP_PASSWORD;
  if (!user || !pass) throw new Error("Set GMAIL_IMAP_USER and GMAIL_IMAP_APP_PASSWORD in scripts/.env");

  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("[Gmail]/All Mail");
  const attachments = [];
  try {
    const uids = await client.search(
      { gmraw: `has:attachment newer_than:${DAYS}d (subject:"Report domain" OR subject:"DMARC")` },
      { uid: true },
    );
    for await (const message of client.fetch(uids, { bodyStructure: true }, { uid: true })) {
      const parts = [];
      const walk = (node) => {
        const filename = node.dispositionParameters?.filename || node.parameters?.name || "";
        // A single-part message (how Google sends reports) has no part number; its body is part "1".
        if (/\.(zip|gz|xml)$/i.test(filename)) parts.push({ part: node.part || "1", filename });
        asArray(node.childNodes).forEach(walk);
      };
      walk(message.bodyStructure);
      for (const { part, filename } of parts) attachments.push({ uid: message.uid, part, filename });
    }
    for (const attachment of attachments) {
      const { content } = await client.download(String(attachment.uid), attachment.part, { uid: true });
      const chunks = [];
      for await (const chunk of content) chunks.push(chunk);
      attachment.buffer = Buffer.concat(chunks);
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return attachments;
}

// Gmail drops long IMAP sessions now and then; a fresh connection almost always succeeds.
async function fetchFromGmailWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchFromGmail();
    } catch (error) {
      if (attempt >= 3) throw error;
      console.warn(`IMAP attempt ${attempt} failed (${error.message}), retrying`);
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
}

const sources = FILES.length
  ? FILES.map((file) => ({ filename: file, buffer: fs.readFileSync(file) }))
  : await fetchFromGmailWithRetry();

const store = fs.existsSync(STORE_PATH) ? JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) : { rows: [] };
const knownReports = new Set(store.rows.map((row) => row.reportId));
const newRows = [];
let newReports = 0;
for (const { filename, buffer } of sources) {
  for (const xml of unpack(filename, buffer)) {
    const rows = parseReport(xml);
    if (!rows.length || knownReports.has(rows[0].reportId)) continue;
    knownReports.add(rows[0].reportId);
    store.rows.push(...rows);
    newRows.push(...rows);
    newReports++;
  }
}
fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
console.log(`${sources.length} attachments, ${newReports} new reports, ${store.rows.length} rows stored\n`);

const isPassing = (row) => row.dkimAligned === "pass" || row.spfAligned === "pass";

function summarize(rows) {
  const byDomain = new Map();
  for (const row of rows) {
    const domain = byDomain.get(row.policyDomain) || { total: 0, passed: 0, policy: row.policy, failures: new Map(), sources: new Set(), orgs: new Set() };
    domain.total += row.count;
    domain.sources.add(row.sourceIp);
    domain.orgs.add(row.org);
    domain.policy = row.policy;
    if (isPassing(row)) domain.passed += row.count;
    else if (row.count > 0) {
      const key = `${row.sourceIp}|dkim ${row.dkimDomains || "none"}; spf ${row.spfDomains || "none"}|${row.disposition}`;
      domain.failures.set(key, (domain.failures.get(key) || 0) + row.count);
    }
    byDomain.set(row.policyDomain, domain);
  }
  for (const domain of byDomain.values()) {
    domain.passRate = domain.total ? domain.passed / domain.total : 1;
    domain.flagged = domain.passRate < PASS_RATE_ALERT;
  }
  return new Map([...byDomain].sort((a, b) => b[1].total - a[1].total));
}

const cutoff = Date.now() - DAYS * 86400000;
const recent = summarize(store.rows.filter((row) => new Date(row.end).getTime() >= cutoff));

console.log(`Last ${DAYS} days`);
for (const [name, domain] of recent) {
  console.log(
    `${domain.flagged ? "ALERT" : "ok   "} ${name.padEnd(24)} ${String(domain.total).padStart(6)} msgs  ${(domain.passRate * 100).toFixed(1).padStart(5)}% pass  p=${domain.policy}  ${domain.sources.size} source IPs`,
  );
  for (const [failure, count] of [...domain.failures].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    const [ip, auth, disposition] = failure.split("|");
    console.log(`        ${String(count).padStart(5)}  ${ip} (${auth}) -> ${disposition}`);
  }
}
if (!recent.size) console.log("No reports in range.");
const alerts = [...recent.values()].filter((domain) => domain.flagged).length;
process.exitCode = alerts ? 2 : 0;

if (args.includes("--email")) await sendEmail(summarize(newRows), summarize(store.rows.filter((row) => new Date(row.end).getTime() >= Date.now() - 7 * 86400000)));

async function reverseDns(ip) {
  try {
    return (await dns.reverse(ip))[0] || "no rDNS";
  } catch {
    return "no rDNS";
  }
}

// Emails only what arrived since the last run, with a 7-day pass rate next to it for context.
async function sendEmail(today, week) {
  const escape = (text) => String(text).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
  const percent = (rate) => `${(rate * 100).toFixed(rate === 1 ? 0 : 1)}%`;
  const flagged = [...today].filter(([, domain]) => domain.flagged);
  const totalMessages = [...today.values()].reduce((sum, domain) => sum + domain.total, 0);
  const subject = !today.size
    ? "DMARC: no new reports"
    : flagged.length
      ? `DMARC: ${flagged.length} ${flagged.length > 1 ? "domains need" : "domain needs"} a look (${flagged.map(([name]) => name).join(", ")})`
      : `DMARC: all clear, ${today.size} domains, ${totalMessages} msgs`;

  const cell = "padding:4px 10px;border-bottom:1px solid #eee;";
  const tableRows = [...today]
    .map(([name, domain]) => {
      const weekRate = week.get(name)?.passRate ?? domain.passRate;
      const color = domain.flagged ? "#b42318" : "#067647";
      return `<tr><td style="${cell}">${escape(name)}</td><td style="${cell}text-align:right">${domain.total}</td><td style="${cell}text-align:right;color:${color};font-weight:600">${percent(domain.passRate)}</td><td style="${cell}text-align:right;color:#667085">${percent(weekRate)}</td><td style="${cell}color:#667085">${escape([...domain.orgs].join(", "))}</td></tr>`;
    })
    .join("");

  const failureLines = [];
  for (const [name, domain] of today) {
    for (const [failure, count] of [...domain.failures].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      const [ip, auth, disposition] = failure.split("|");
      failureLines.push(`<li><b>${escape(name)}</b>: ${count} msg from ${escape(ip)} (${escape(await reverseDns(ip))}), ${escape(auth)}, receiver action: ${escape(disposition)}</li>`);
    }
  }

  const silentDomains = [...week.keys()].filter((name) => !today.has(name));
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#101828;max-width:640px">
${today.size ? `<p>${newReports} new reports covering ${totalMessages} messages. A domain is flagged under ${percent(PASS_RATE_ALERT)} passing.</p>
<table style="border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#667085"><th style="${cell}">Domain</th><th style="${cell}text-align:right">Msgs</th><th style="${cell}text-align:right">Pass</th><th style="${cell}text-align:right">7-day</th><th style="${cell}">Reported by</th></tr>${tableRows}</table>` : "<p>No new DMARC reports arrived since the last run.</p>"}
${failureLines.length ? `<p style="margin-top:16px"><b>Failing sources</b> (a security scanner or forwarder in rDNS is usually harmless; an unknown host sending as you is not)</p><ul>${failureLines.join("")}</ul>` : ""}
${silentDomains.length ? `<p style="color:#667085">No new report for: ${escape(silentDomains.join(", "))}. Normal if they did not send to Gmail/Outlook that day.</p>` : ""}
</div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.RESEND_API_KEY },
    body: JSON.stringify({
      from: process.env.DMARC_REPORT_FROM || "DMARC Monitor <dmarc@beenex.org>",
      to: process.env.DMARC_REPORT_TO || process.env.GMAIL_IMAP_USER,
      subject,
      html,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Resend ${response.status}: ${JSON.stringify(result)}`);
  console.log(`\nEmailed "${subject}" (${result.id})`);
}
