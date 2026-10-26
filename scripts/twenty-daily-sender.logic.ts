// Source of the Twenty logic function behind "Campaign 1 — Daily Follow-up Sender".
// Port of scripts/send_followup.js so the cron inside Twenty can do what the script does.
// Keys are substituted from scripts/.env when this file is pushed with scripts/push_logic_function.js.

const TWENTY_API_URL = "https://20.beenex.cloud/graphql";
const TWENTY_API_TOKEN = "__TWENTY_API_KEY__";
const RESEND_API_KEY = "__RESEND_API_KEY__";

const SENDER_NAME = "Javier Sanchez";
const REPLY_TO = ["thomas@beenex.ai", "javier@beenex.ai", "matt@beenex.ai"];
const BOOKING_URL = "https://meetings.hubspot.com/beenex/social-bloom-architecture-fit-call";
const EXCLUDED_NAMES = ["TEST — Internal Send Test (delete after)"];
const MAX_SENDS_PER_RUN = 50;
const ROTATION = [
  "javier@beenex.company",
  "javier@beenex.digital",
  "javier@beenex.cloud",
  "javier@beenex.space",
  "javier@beenex.info",
  "javier@beenex.solutions",
  "javier@beenex.tech",
  "javier@beenex.org",
  "javier@getbeenex.com",
];

type Stage = {
  action: string;
  stage: string;
  bodyField: "day0Email" | "day4Email" | "day10Email";
  nextStage: string;
  nextAction: string;
  nextDelayDays: number;
  label: string;
};

const STAGES: Stage[] = [
  { action: "SEND_SEQ1", stage: "READY", bodyField: "day0Email", nextStage: "SEQ1_SENT", nextAction: "SEND_SEQ2", nextDelayDays: 3, label: "Day 0" },
  { action: "SEND_SEQ2", stage: "SEQ1_SENT", bodyField: "day4Email", nextStage: "SEQ2_SENT", nextAction: "SEND_SEQ3", nextDelayDays: 6, label: "Day 4" },
  { action: "SEND_SEQ3", stage: "SEQ2_SENT", bodyField: "day10Email", nextStage: "SEQ3_SENT", nextAction: "LI_INVITE", nextDelayDays: 2, label: "Day 10" },
];

type Person = {
  id: string;
  name?: string;
  email?: string;
  companyName?: string;
  specificWorkflow?: string;
  emailsSent?: number;
  lastSentFrom?: string;
  lastMessageId?: string;
  nextActionDue?: string;
  sequenceStage?: string;
  nextAction?: string;
};

async function twenty(query: string, variables?: Record<string, unknown>): Promise<any> {
  const res = await fetch(TWENTY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TWENTY_API_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json();
  if (json.errors) throw new Error("Twenty: " + JSON.stringify(json.errors));
  return json.data;
}

async function resend(method: string, url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch("https://api.resend.com" + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + RESEND_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function duePeople(stage: Stage): Promise<Person[]> {
  const data = await twenty(`query {
    campaign1People(
      filter: { nextAction: { eq: ${stage.action} }, sequenceStage: { eq: ${stage.stage} } }
      first: 100
    ) {
      edges { node {
        id name email companyName specificWorkflow emailsSent
        lastSentFrom lastMessageId nextActionDue sequenceStage nextAction
      } }
    }
  }`);
  return data.campaign1People.edges.map((e: any) => e.node);
}

async function cohortRecord(name: string): Promise<any | null> {
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
  return data.c1.edges[0]?.node || data.pilot.edges[0]?.node || null;
}

const companyShort = (s?: string): string =>
  (s || "").replace(/,?\s*(LLC|L\.L\.C\.|P\.C\.|PLLC|Inc\.?|Incorporated|Ltd\.?|P\.?A)\.?$/i, "").trim() || "the practice";

const firstNameOf = (s?: string): string => {
  const t = (s || "").replace(/^(Dr\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, "").trim();
  return t.split(/[\s,]+/)[0] || "there";
};

const hashId = (s: string): number => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
};

function genericBody(stage: Stage, person: Person, placeholders: any): string {
  const first = placeholders?.["First name"] || firstNameOf(person.name);
  const co = companyShort(person.companyName || placeholders?.Practice);
  const wf = placeholders?.specificWorkflow || person.specificWorkflow || "that workflow";
  if (stage.label === "Day 4") {
    return [
      `Hi ${first},`,
      `A quick note on what the 30 minutes covers, so it is easy to decide.`,
      `We walk through ${wf} at ${co}: where information enters, which systems it passes through, and where your staff re-enter or chase it. You leave with a one-page view of where the handoffs break, whether or not we work together.`,
      `The call needs no system access and no patient data. If there is a fit, the next step is a paid System Map Sprint, and any build is quoted at a fixed fee after the scope is agreed.`,
      `Would Tuesday or Wednesday next week work? You can also pick a time here: ${BOOKING_URL}`,
      `Best,\nJavier`,
    ].join("\n\n");
  }
  if (stage.label === "Day 10") {
    return [
      `Hi ${first},`,
      `Last note from me on ${wf}. If it already runs the way you want at ${co}, ignore this and I won't email again.`,
      `If a call is more than it's worth right now, there is a smaller option: reply with one line on how ${wf} works today, and I'll send back a short sketch of where I would look first. No call, no system access.`,
      `If someone else at ${co} owns that process, a name is all I need.`,
      `And if the timing is right, here is my calendar for a 30-minute conversation: ${BOOKING_URL}`,
      `Best,\nJavier`,
    ].join("\n\n");
  }
  return "";
}

function textToHtml(plainText: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

function nextDueDate(delayDays: number): string {
  const d = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
  d.setUTCHours(13, 0, 0, 0);
  // Follow-ups land on a weekday morning, never Saturday or Sunday.
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

async function sendOne(stage: Stage, person: Person, dryRun: boolean): Promise<{ ok: boolean; note: string }> {
  const cohort = await cohortRecord(person.name || "");
  const placeholders = cohort?.placeholders || {};
  const stored: string = (cohort?.[stage.bodyField] || "").trim();

  let subject = "";
  let bodyText = "";
  let fromEmail = person.lastSentFrom || "";
  let inReplyTo = "";

  if (stage.label === "Day 0") {
    const m = stored.match(/^Subject:\s*([^\n]+)\n+([\s\S]*)$/i);
    if (!m) return { ok: false, note: "no day0Email with a Subject line on the cohort record" };
    subject = m[1].trim();
    bodyText = m[2].trim();
    fromEmail = ROTATION[(hashId(person.id) + (person.emailsSent || 0)) % ROTATION.length];
  } else {
    if (!person.lastMessageId) return { ok: false, note: "no previous message id to thread on" };
    const prev = await resend("GET", "/emails/" + person.lastMessageId);
    if (prev.status !== 200) return { ok: false, note: "previous email not found in Resend: " + prev.status };
    const threadSubject: string = prev.data.subject || "";
    subject = threadSubject.startsWith("Re:") ? threadSubject : "Re: " + threadSubject;
    inReplyTo = prev.data.message_id || "";
    const fm = String(prev.data.from || "").match(/<([^>]+)>/);
    if (fm) fromEmail = fm[1];
    bodyText = stored || genericBody(stage, person, placeholders);
  }

  if (!fromEmail) return { ok: false, note: "no sender address" };
  if (!bodyText) return { ok: false, note: "no body" };
  if (/\[[^\]]+\]/.test(bodyText)) return { ok: false, note: "unresolved [bracket] in body" };

  const payload: any = {
    from: `${SENDER_NAME} <${fromEmail}>`,
    to: [person.email],
    reply_to: REPLY_TO,
    subject,
    html: textToHtml(bodyText),
    text: bodyText,
  };
  if (inReplyTo) payload.headers = { "In-Reply-To": inReplyTo, References: inReplyTo };

  if (dryRun) {
    return { ok: true, note: `DRY ${stage.label} from ${fromEmail}; subject "${subject}"; threaded ${inReplyTo ? "yes" : "no"}; body ${bodyText.length} chars` };
  }

  const sent = await resend("POST", "/emails", payload);
  if (sent.status !== 200 || !sent.data?.id) {
    return { ok: false, note: "Resend " + sent.status + " " + JSON.stringify(sent.data) };
  }

  await twenty(
    `mutation UpdatePerson($id: ID!, $data: Campaign1PersonUpdateInput!) {
      updateCampaign1Person(id: $id, data: $data) { id }
    }`,
    {
      id: person.id,
      data: {
        sequenceStage: stage.nextStage,
        emailsSent: (person.emailsSent || 0) + 1,
        nextAction: stage.nextAction,
        nextActionDue: nextDueDate(stage.nextDelayDays),
        lastSentFrom: fromEmail,
        lastMessageId: sent.data.id,
      },
    },
  );
  return { ok: true, note: `${stage.label} from ${fromEmail} (${sent.data.id})` };
}

export const main = async (params: { dryRun?: boolean | string; ignoreDue?: boolean | string }) => {
  const dryRun = params?.dryRun === true || params?.dryRun === "true";
  const ignoreDue = params?.ignoreDue === true || params?.ignoreDue === "true";
  const now = new Date();
  const lines: string[] = [`Run at ${now.toISOString()}${dryRun ? " (dry run, nothing sent)" : ""}${ignoreDue ? " (due dates ignored)" : ""}`];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const stage of STAGES) {
    let people: Person[] = [];
    try {
      people = await duePeople(stage);
    } catch (err: any) {
      lines.push(`${stage.label}: query failed: ${err.message}`);
      failed++;
      continue;
    }
    const due = people.filter(
      (p) =>
        p.email &&
        !EXCLUDED_NAMES.includes(p.name || "") &&
        (ignoreDue || !p.nextActionDue || new Date(p.nextActionDue) <= now),
    );
    lines.push(`${stage.label}: ${people.length} at stage, ${due.length} due`);

    for (const person of due) {
      if (sent >= MAX_SENDS_PER_RUN) {
        lines.push(`cap of ${MAX_SENDS_PER_RUN} sends reached; remaining contacts stay due for tomorrow`);
        break;
      }
      try {
        const r = await sendOne(stage, person, dryRun);
        if (r.ok) {
          sent++;
          lines.push(`SENT ${person.email}: ${r.note}`);
        } else {
          skipped++;
          lines.push(`SKIP ${person.email}: ${r.note}`);
        }
      } catch (err: any) {
        failed++;
        lines.push(`FAIL ${person.email}: ${err.message}`);
      }
    }
  }

  return { sent, skipped, failed, report: lines.join("\n") };
};
