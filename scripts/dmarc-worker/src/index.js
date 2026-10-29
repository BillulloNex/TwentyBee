// Receives DMARC aggregate reports at the Email Routing address, stores them in D1, and emails a daily
// summary of reports that arrived since the last summary. Ports scripts/dmarc-report-sync.mjs to Cloudflare.

import PostalMime from "postal-mime";
import { gunzipSync, strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

// Below this share of DMARC-passing mail on a domain we flag it; one-off forwarders keep it from being 100%.
const PASS_RATE_ALERT = 0.98;

const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
const asArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

// Senders mislabel extensions, so sniff magic bytes instead of trusting the filename.
function unpack(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return Object.entries(unzipSync(bytes))
      .filter(([name]) => name.toLowerCase().endsWith(".xml"))
      .map(([, content]) => strFromU8(content));
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return [strFromU8(gunzipSync(bytes))];
  const head = strFromU8(bytes.subarray(0, 200));
  return head.includes("<feedback") || head.includes("<?xml") ? [strFromU8(bytes)] : [];
}

function parseReport(xml) {
  const feedback = xmlParser.parse(xml).feedback;
  if (!feedback) return null;
  const metadata = feedback.report_metadata;
  const policy = feedback.policy_published;
  return {
    reportId: `${metadata.org_name}:${metadata.report_id}`,
    org: metadata.org_name,
    policyDomain: policy.domain,
    policy: policy.p,
    beginAt: new Date(Number(metadata.date_range.begin) * 1000).toISOString(),
    endAt: new Date(Number(metadata.date_range.end) * 1000).toISOString(),
    records: asArray(feedback.record).map((record) => {
      const evaluated = record.row.policy_evaluated;
      return {
        headerFrom: record.identifiers?.header_from ?? null,
        sourceIp: record.row.source_ip,
        count: Number(record.row.count),
        disposition: evaluated.disposition ?? null,
        dkimAligned: evaluated.dkim ?? null,
        spfAligned: evaluated.spf ?? null,
        dkimDomains: asArray(record.auth_results?.dkim).map((dkim) => `${dkim.domain}=${dkim.result}`).join(", "),
        spfDomains: asArray(record.auth_results?.spf).map((spf) => `${spf.domain}=${spf.result}`).join(", "),
      };
    }),
  };
}

async function storeReport(env, report) {
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO reports (report_id, org, policy_domain, policy, begin_at, end_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(report.reportId, report.org, report.policyDomain, report.policy, report.beginAt, report.endAt)
    .run();
  if (!inserted.meta.changes) return false;
  const insertRecord = env.DB.prepare(
    "INSERT INTO records (report_id, policy_domain, header_from, source_ip, count, disposition, dkim_aligned, spf_aligned, dkim_domains, spf_domains) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  await env.DB.batch(
    report.records.map((record) =>
      insertRecord.bind(
        report.reportId,
        report.policyDomain,
        record.headerFrom,
        record.sourceIp,
        record.count,
        record.disposition,
        record.dkimAligned,
        record.spfAligned,
        record.dkimDomains,
        record.spfDomains,
      ),
    ),
  );
  return true;
}

function summarize(rows) {
  const byDomain = new Map();
  for (const row of rows) {
    const domain = byDomain.get(row.policy_domain) || { total: 0, passed: 0, failures: new Map(), orgs: new Set() };
    domain.total += row.count;
    domain.orgs.add(row.org);
    if (row.dkim_aligned === "pass" || row.spf_aligned === "pass") domain.passed += row.count;
    else if (row.count > 0) {
      const key = `${row.source_ip}|dkim ${row.dkim_domains || "none"}; spf ${row.spf_domains || "none"}|${row.disposition}`;
      domain.failures.set(key, (domain.failures.get(key) || 0) + row.count);
    }
    byDomain.set(row.policy_domain, domain);
  }
  for (const domain of byDomain.values()) {
    domain.passRate = domain.total ? domain.passed / domain.total : 1;
    domain.flagged = domain.passRate < PASS_RATE_ALERT;
  }
  return new Map([...byDomain].sort((a, b) => b[1].total - a[1].total));
}

// Workers have no reverse DNS API, so ask Cloudflare's DNS-over-HTTPS resolver for the PTR record.
async function reverseDns(ip) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return "no rDNS";
  const name = `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${name}&type=PTR`, { headers: { accept: "application/dns-json" } });
    const answer = (await response.json()).Answer?.[0]?.data;
    return answer ? answer.replace(/\.$/, "") : "no rDNS";
  } catch {
    return "no rDNS";
  }
}

const RECORDS_QUERY = "SELECT records.*, reports.org FROM records JOIN reports USING (report_id)";

async function sendSummary(env) {
  const pending = await env.DB.prepare("SELECT report_id FROM reports WHERE emailed_at IS NULL").all();
  const pendingIds = pending.results.map((row) => row.report_id);
  const todayRows = pendingIds.length
    ? (await env.DB.prepare(`${RECORDS_QUERY} WHERE reports.emailed_at IS NULL`).all()).results
    : [];
  const weekRows = (await env.DB.prepare(`${RECORDS_QUERY} WHERE reports.end_at >= datetime('now', '-7 days')`).all()).results;
  const today = summarize(todayRows);
  const week = summarize(weekRows);

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
${today.size ? `<p>${pendingIds.length} new reports covering ${totalMessages} messages. A domain is flagged under ${percent(PASS_RATE_ALERT)} passing.</p>
<table style="border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#667085"><th style="${cell}">Domain</th><th style="${cell}text-align:right">Msgs</th><th style="${cell}text-align:right">Pass</th><th style="${cell}text-align:right">7-day</th><th style="${cell}">Reported by</th></tr>${tableRows}</table>` : "<p>No new DMARC reports arrived since the last summary.</p>"}
${failureLines.length ? `<p style="margin-top:16px"><b>Failing sources</b> (a security scanner or forwarder in rDNS is usually harmless; an unknown host sending as you is not)</p><ul>${failureLines.join("")}</ul>` : ""}
${silentDomains.length ? `<p style="color:#667085">No new report for: ${escape(silentDomains.join(", "))}. Normal if they did not send to Gmail/Outlook that day.</p>` : ""}
</div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: env.REPORT_FROM, to: env.REPORT_TO, subject, html }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Resend ${response.status}: ${JSON.stringify(result)}`);

  if (pendingIds.length) {
    await env.DB.prepare("UPDATE reports SET emailed_at = datetime('now') WHERE emailed_at IS NULL").run();
  }
  return { subject, emailId: result.id, reports: pendingIds.length };
}

export default {
  async email(message, env) {
    const email = await PostalMime.parse(message.raw);
    let stored = 0;
    for (const attachment of email.attachments) {
      const bytes = new Uint8Array(attachment.content);
      for (const xml of unpack(bytes)) {
        const report = parseReport(xml);
        if (report && (await storeReport(env, report))) stored++;
      }
    }
    console.log(`from ${message.from}: ${email.attachments.length} attachments, ${stored} new reports`);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sendSummary(env).then((result) => console.log(JSON.stringify(result))));
  },

  // Manual trigger for testing: POST /send with the RUN_TOKEN secret as a bearer token.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/send") return new Response("Not found", { status: 404 });
    if (request.headers.get("authorization") !== `Bearer ${env.RUN_TOKEN}`) return new Response("Unauthorized", { status: 401 });
    return Response.json(await sendSummary(env));
  },
};
