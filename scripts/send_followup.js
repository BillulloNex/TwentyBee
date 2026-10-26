// Campaign 1 follow-up sender for Day 4 and Day 10.
// Dry run by default. Flags:
//   --day 4|10          which follow-up to send (default 4)
//   --send              actually send and update Twenty
//   --only <email>      restrict to one recipient
//   --ignore-due        include contacts whose nextActionDue is still in the future (staging a dry run)
//   --copy-file <json>  { "<email>": "<body text>" } overrides the body stored in Twenty, for review before sync
// Uses the same Resend transport that delivered Day 0 on 2026-10-23.

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TWENTY_API_TOKEN = process.env.TWENTY_API_KEY;
const TWENTY_API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud").replace(/\/$/, "") + "/graphql";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!TWENTY_API_TOKEN || !RESEND_API_KEY) {
  console.error("Missing TWENTY_API_KEY or RESEND_API_KEY in scripts/.env");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SEND = args.includes("--send");
const IGNORE_DUE = args.includes("--ignore-due");
const ONLY = flag("--only");
const DAY = Number(flag("--day") || 4);
const COPY_FILE = flag("--copy-file");

const SENDER_NAME = "Javier Sanchez";
const REPLY_TO = ["thomas@beenex.ai", "javier@beenex.ai", "matt@beenex.ai"];
const BOOKING_URL = "https://meetings.hubspot.com/beenex/social-bloom-architecture-fit-call";
const EXCLUDED_NAMES = ["TEST — Internal Send Test (delete after)"];
const OUT_DIR = path.join(__dirname, "..", "artifacts", "campaign-1-email-drafts");
const TODAY = new Date().toISOString().slice(0, 10);

const DAY_CONFIG = {
  4: {
    dueAction: "SEND_SEQ2",
    dueStage: "SEQ1_SENT",
    bodyField: "day4Email",
    nextStage: "SEQ2_SENT",
    nextAction: "SEND_SEQ3",
    nextDelayDays: 6,
  },
  10: {
    dueAction: "SEND_SEQ3",
    dueStage: "SEQ2_SENT",
    bodyField: "day10Email",
    nextStage: "SEQ3_SENT",
    nextAction: "LI_INVITE",
    nextDelayDays: 2,
  },
};
const CFG = DAY_CONFIG[DAY];
if (!CFG) {
  console.error("--day must be 4 or 10");
  process.exit(1);
}

const COPY_OVERRIDES = COPY_FILE ? JSON.parse(fs.readFileSync(COPY_FILE, "utf8")) : {};

async function twenty(query, variables) {
  const res = await fetch(TWENTY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TWENTY_API_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error("Twenty: " + JSON.stringify(json.errors));
  return json.data;
}

async function resend(method, url, body) {
  const res = await fetch("https://api.resend.com" + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + RESEND_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function getDuePeople() {
  const data = await twenty(`query {
    campaign1People(
      filter: { nextAction: { eq: ${CFG.dueAction} }, sequenceStage: { eq: ${CFG.dueStage} } }
      first: 100
    ) {
      edges { node {
        id name email companyName cohort specificWorkflow emailsSent
        lastSentFrom lastMessageId nextActionDue sequenceStage nextAction
      } }
    }
  }`);
  return data.campaign1People.edges.map((e) => e.node);
}

async function getCohortRecord(name) {
  const data = await twenty(
    `query FindCohort($name: String!) {
      c1: campaign1CohortOnes(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email placeholders } }
      }
      pilot: campaign1CohortPilots(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email placeholders } }
      }
    }`,
    { name },
  );
  const c1 = data.c1.edges[0]?.node;
  if (c1) return { source: "campaign1CohortOne", ...c1 };
  const pilot = data.pilot.edges[0]?.node;
  if (pilot) return { source: "campaign1CohortPilot", ...pilot };
  return null;
}

const companyShort = (s) =>
  (s || "").replace(/,?\s*(LLC|L\.L\.C\.|P\.C\.|PLLC|Inc\.?|Incorporated|Ltd\.?|P\.?A)\.?$/i, "").trim() || "the practice";

const firstNameOf = (s) => {
  const t = (s || "").replace(/^(Dr\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, "").trim();
  return t.split(/[\s,]+/)[0] || "there";
};

function genericDay4(person, placeholders) {
  const first = placeholders?.["First name"] || firstNameOf(person.name);
  const co = companyShort(person.companyName || placeholders?.Practice);
  const wf = placeholders?.specificWorkflow || person.specificWorkflow || "that workflow";
  return [
    `Hi ${first},`,
    `A quick note on what the 30 minutes covers, so it is easy to decide.`,
    `We walk through ${wf} at ${co}: where information enters, which systems it passes through, and where your staff re-enter or chase it. You leave with a one-page view of where the handoffs break, whether or not we work together.`,
    `The call needs no system access and no patient data. If there is a fit, the next step is a paid System Map Sprint, and any build is quoted at a fixed fee after the scope is agreed.`,
    `Would Tuesday or Wednesday next week work? You can also pick a time here: ${BOOKING_URL}`,
    `Best,\nJavier`,
  ].join("\n\n");
}

function genericDay10(person, placeholders) {
  const first = placeholders?.["First name"] || firstNameOf(person.name);
  const co = companyShort(person.companyName || placeholders?.Practice);
  const wf = placeholders?.specificWorkflow || person.specificWorkflow || "that workflow";
  return [
    `Hi ${first},`,
    `Last note from me on ${wf}. If it already runs the way you want at ${co}, ignore this and I won't email again.`,
    `If a call is more than it's worth right now, there is a smaller option: reply with one line on how ${wf} works today, and I'll send back a short sketch of where I would look first. No call, no system access.`,
    `If someone else at ${co} owns that process, a name is all I need.`,
    `And if the timing is right, here is my calendar for a 30-minute conversation: ${BOOKING_URL}`,
    `Best,\nJavier`,
  ].join("\n\n");
}

const GENERIC = { 4: genericDay4, 10: genericDay10 };

function textToHtml(plainText) {
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return plainText
    .split(/\n\s*\n/)
    .map((para) => {
      const html = escape(para.trim())
        .replace(/(https?:\/\/[^\s<]+)/g, (match) => {
          let url = match;
          let trailing = "";
          const punct = url.match(/[.,;:?!)]+$/);
          if (punct) {
            trailing = punct[0];
            url = url.slice(0, -trailing.length);
          }
          return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8">${url}</a>${trailing}`;
        })
        .replace(/\n/g, "<br/>");
      return `<p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#333">${html}</p>`;
    })
    .join("\n");
}

async function previousEmail(person) {
  // Sends store the Resend id; the internal test record once stored a raw Message-ID.
  if (person.lastMessageId && !person.lastMessageId.startsWith("<")) {
    const { status, data } = await resend("GET", "/emails/" + person.lastMessageId);
    if (status === 200) {
      return { subject: data.subject, from: data.from, messageId: data.message_id };
    }
  }
  return { subject: null, from: null, messageId: person.lastMessageId || null };
}

async function compose(person) {
  const cohort = await getCohortRecord(person.name);
  const previous = await previousEmail(person);
  const placeholders = cohort?.placeholders || {};

  let threadSubject = previous.subject;
  if (!threadSubject && cohort?.day0Email) {
    const m = cohort.day0Email.match(/^Subject:\s*([^\n]+)/i);
    if (m) threadSubject = m[1].trim();
  }
  if (!threadSubject) {
    threadSubject = `${person.specificWorkflow || "workflow"} at ${companyShort(person.companyName)}`;
  }
  const subject = threadSubject.startsWith("Re:") ? threadSubject : `Re: ${threadSubject}`;

  const override = COPY_OVERRIDES[person.email?.toLowerCase()];
  const stored = cohort?.[CFG.bodyField]?.trim();
  let bodyText;
  let bodySource;
  if (override) {
    bodyText = override.trim();
    bodySource = `override file`;
  } else if (stored) {
    bodyText = stored;
    bodySource = `${cohort.source}.${CFG.bodyField}`;
  } else {
    bodyText = GENERIC[DAY](person, placeholders);
    bodySource = `generic Day ${DAY} template`;
  }

  let fromEmail = person.lastSentFrom;
  if (previous.from) {
    const m = previous.from.match(/<([^>]+)>/);
    if (m) fromEmail = m[1];
  }
  const warnings = [];
  if (!fromEmail) warnings.push("no previous sender address on record");
  if (!previous.messageId) warnings.push("no previous Message-ID; reply will not thread");
  if (!cohort) warnings.push("no cohort record found by name");
  if (/\[[^\]]+\]/.test(bodyText)) warnings.push("unresolved [bracket] in body");

  const nextDue = new Date(Date.now() + CFG.nextDelayDays * 24 * 60 * 60 * 1000);
  nextDue.setUTCHours(13, 0, 0, 0);
  // Follow-ups should land on a weekday morning, not a Saturday or Sunday.
  while (nextDue.getUTCDay() === 0 || nextDue.getUTCDay() === 6) {
    nextDue.setUTCDate(nextDue.getUTCDate() + 1);
  }

  return {
    person,
    subject,
    bodyText,
    bodySource,
    fromEmail,
    inReplyTo: previous.messageId,
    warnings,
    nextDue: nextDue.toISOString(),
  };
}

async function sendOne(c) {
  const payload = {
    from: `${SENDER_NAME} <${c.fromEmail}>`,
    to: [c.person.email],
    reply_to: REPLY_TO,
    subject: c.subject,
    html: textToHtml(c.bodyText),
    text: c.bodyText,
  };
  if (c.inReplyTo) payload.headers = { "In-Reply-To": c.inReplyTo, References: c.inReplyTo };
  return resend("POST", "/emails", payload);
}

async function updatePerson(c, resendId) {
  return twenty(
    `mutation UpdatePerson($id: ID!, $data: Campaign1PersonUpdateInput!) {
      updateCampaign1Person(id: $id, data: $data) { id sequenceStage nextAction nextActionDue emailsSent }
    }`,
    {
      id: c.person.id,
      data: {
        sequenceStage: CFG.nextStage,
        emailsSent: (c.person.emailsSent || 0) + 1,
        nextAction: CFG.nextAction,
        nextActionDue: c.nextDue,
        lastSentFrom: c.fromEmail,
        lastMessageId: resendId,
      },
    },
  );
}

async function main() {
  const now = new Date();
  let people = await getDuePeople();
  people = people.filter(
    (p) =>
      p.email &&
      !EXCLUDED_NAMES.includes(p.name) &&
      (IGNORE_DUE || !p.nextActionDue || new Date(p.nextActionDue) <= now) &&
      (!ONLY || p.email.toLowerCase() === ONLY.toLowerCase()),
  );
  const label = `Day ${DAY}`;
  console.log(`${SEND ? "SEND" : "DRY RUN"} ${label}: ${people.length} contacts${IGNORE_DUE ? " (due date ignored)" : " due"}\n`);

  const composed = [];
  for (const p of people) composed.push(await compose(p));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const preview = [
    `# ${label} ${SEND ? "send" : "dry run"} ${now.toISOString()}`,
    "",
    "| # | To | From | Subject | Body source | Threaded | Warnings |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...composed.map(
      (c, i) =>
        `| ${i + 1} | ${c.person.name} <${c.person.email}> | ${c.fromEmail} | ${c.subject} | ${c.bodySource} | ${c.inReplyTo ? "yes" : "no"} | ${c.warnings.join("; ") || ""} |`,
    ),
    "",
    ...composed.flatMap((c, i) => [
      `## ${i + 1}. ${c.person.name} <${c.person.email}>`,
      "",
      `**From:** ${SENDER_NAME} <${c.fromEmail}>  `,
      `**Reply-To:** ${REPLY_TO.join(", ")}  `,
      `**Subject:** ${c.subject}  `,
      `**In-Reply-To:** ${c.inReplyTo || "none"}  `,
      `**Body source:** ${c.bodySource}  `,
      `**Next action after send:** ${CFG.nextAction} due ${c.nextDue}`,
      "",
      "```",
      c.bodyText,
      "```",
      "",
    ]),
  ].join("\n");
  const previewPath = path.join(OUT_DIR, `day${DAY}-${SEND ? "send" : "dry-run"}-${TODAY}.md`);
  fs.writeFileSync(previewPath, preview);

  for (const [i, c] of composed.entries()) {
    console.log(`[${i + 1}/${composed.length}] ${c.person.name} <${c.person.email}>`);
    console.log(`   From: ${c.fromEmail}   Subject: ${c.subject}`);
    console.log(`   Body: ${c.bodySource}   Threaded: ${c.inReplyTo ? "yes" : "NO"}`);
    if (c.warnings.length) console.log(`   WARN: ${c.warnings.join("; ")}`);
  }
  console.log(`\nPreview written to ${previewPath}`);

  if (!SEND) {
    console.log("Dry run only. Re-run with --send to deliver.");
    return;
  }

  const results = [];
  for (const [i, c] of composed.entries()) {
    if (c.warnings.some((w) => w.startsWith("no previous sender") || w.startsWith("unresolved"))) {
      console.log(`[${i + 1}] SKIPPED ${c.person.email}: ${c.warnings.join("; ")}`);
      results.push({ email: c.person.email, success: false, skipped: true, warnings: c.warnings });
      continue;
    }
    const { status, data } = await sendOne(c);
    if (status !== 200 || !data.id) {
      console.log(`[${i + 1}] FAILED ${c.person.email}: ${JSON.stringify(data)}`);
      results.push({ email: c.person.email, success: false, error: data });
      continue;
    }
    let crm = null;
    try {
      crm = await updatePerson(c, data.id);
    } catch (err) {
      console.log(`[${i + 1}] SENT ${c.person.email} (${data.id}) but Twenty update failed: ${err.message}`);
      results.push({ email: c.person.email, success: true, resendId: data.id, crmUpdated: false, error: err.message });
      continue;
    }
    const u = crm.updateCampaign1Person;
    console.log(`[${i + 1}] SENT ${c.person.email} from ${c.fromEmail} (${data.id}); Twenty -> ${u.sequenceStage}, next ${u.nextAction} ${u.nextActionDue}`);
    results.push({ email: c.person.email, success: true, resendId: data.id, crmUpdated: true, from: c.fromEmail });
    if (i < composed.length - 1) await new Promise((r) => setTimeout(r, 1000));
  }

  const resultsPath = path.join(OUT_DIR, `day${DAY}-send-results-${TODAY}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.success).length;
  console.log(`\nDone: ${ok}/${results.length} sent. Results in ${resultsPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
