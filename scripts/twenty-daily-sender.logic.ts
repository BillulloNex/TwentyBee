// Source of the Twenty logic function behind "Campaign 1 — Daily Follow-up Sender", which also sends Campaigns 2 and 3.
// Campaign 1 part is a port of scripts/send_followup.js so the cron inside Twenty can do what the script does.
// Keys are substituted from scripts/.env when this file is pushed with scripts/push_logic_function.js.

const TWENTY_API_URL = "https://20.beenex.cloud/graphql";
const TWENTY_API_TOKEN = "__TWENTY_API_KEY__";
const RESEND_API_KEY = "__RESEND_API_KEY__";

const SENDER_NAME = "Javier Sanchez";
const REPLY_TO = ["thomas@beenex.ai", "javier@beenex.ai", "matt@beenex.ai"];
const BOOKING_URL = "https://meetings.hubspot.com/beenex/social-bloom-architecture-fit-call";
const EXCLUDED_NAMES = ["TEST — Internal Send Test (delete after)"];
const MAX_SENDS_PER_RUN = 100;
const SENDING_DOMAINS = [
  "beenex.company",
  "beenex.digital",
  "beenex.cloud",
  "beenex.space",
  "beenex.info",
  "beenex.solutions",
  "beenex.tech",
  "beenex.org",
  "getbeenex.com",
];
// Five sender names per domain keeps each address near 20 sends a day (deliverability rule from the Instantly call)
// while domain volume stays far under 100 a day. Follow-ups reuse lastSentFrom, so threads never switch address.
const ROTATION = ["javier", "javi", "jsanchez", "j", "sanchez"].flatMap((localPart) => SENDING_DOMAINS.map((domain) => `${localPart}@${domain}`));
const OWN_DOMAINS = [...ROTATION, ...REPLY_TO].map((address) => address.split("@")[1]);
// Resend's acceptable-use policy requires a company name and postal address on unsolicited email.
const FOOTER_TEXT = `BeeNex, 2412 Irwin Street, Melbourne, FL 32901\nIf this isn't relevant, reply "no thanks" and I won't follow up.`;
// Ramp agreed after the Instantly call: per sending domain per day (Eastern), raised weekly while bounces stay low.
const DOMAIN_DAILY_CAPS: [string, number][] = [
  ["2026-11-01", 20],
  ["2026-11-23", 35],
  ["2026-11-30", 50],
  ["2026-12-07", 75],
  ["2026-12-14", 100],
];
// Instantly pauses a campaign at 3% bounces. Under ~50 sends a single bounce crosses 3%, so small
// samples pause on a bounce count instead.
const BOUNCE_PAUSE_RATE = 0.03;
const BOUNCE_PAUSE_MIN_SENDS = 50;
const BOUNCE_PAUSE_COUNT = 3;
const BOUNCE_WINDOW_DAYS = 7;
// A reply from anyone at a practice's own domain stops the sequence for everyone there;
// shared consumer domains only match the exact address.
const SHARED_MAIL_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "me.com", "msn.com", "live.com", "comcast.net", "att.net", "protonmail.com"];
const AUTO_REPLY_SUBJECT = /automatic reply|auto[- ]?reply|autoreply|out of (the )?office|away from (the )?office|vacation|your mail to|undeliver|delivery status|mail delivery|returned mail/i;

type Stage = {
  action: string;
  stage: string;
  bodyField: string;
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

// Campaign 2 keeps the subject and all three bodies on the lead's own cohort record. Only cohorts
// listed here send; a lead also needs sequenceStage READY and nextAction SEND_SEQ1 to start.
const CAMPAIGN2_COPY_RELATION: Record<string, string> = {
  C2_COHORT_1: "cohort1Copy",
  C2_COHORT_2: "cohort2Copy",
  C2_COHORT_3: "cohort3Copy",
  C2_COHORT_4: "cohort4Copy",
};
const CAMPAIGN2_STAGES: Stage[] = [
  { action: "SEND_SEQ1", stage: "READY", bodyField: "email1", nextStage: "SEQ1_SENT", nextAction: "SEND_SEQ2", nextDelayDays: 4, label: "Day 0" },
  { action: "SEND_SEQ2", stage: "SEQ1_SENT", bodyField: "email2", nextStage: "SEQ2_SENT", nextAction: "SEND_SEQ3", nextDelayDays: 6, label: "Day 4" },
  { action: "SEND_SEQ3", stage: "SEQ2_SENT", bodyField: "email3", nextStage: "SEQ3_SENT", nextAction: "NONE", nextDelayDays: 0, label: "Day 10" },
];

// Campaign 3 keeps the copy on the person record and runs a one-week sequence: Day 0, Day 2, Day 4
// (Monday, Wednesday, Friday when it starts on a Monday). Only verified, VALID-email leads in these
// cohorts send, and a lead also needs sequenceStage READY and nextAction SEND_SEQ1 to start.
const CAMPAIGN3_COHORTS = ["C3_COHORT_1", "C3_COHORT_3", "C3_COHORT_4"];
const CAMPAIGN3_STAGES: Stage[] = [
  { action: "SEND_SEQ1", stage: "READY", bodyField: "email1", nextStage: "SEQ1_SENT", nextAction: "SEND_SEQ2", nextDelayDays: 2, label: "Day 0" },
  { action: "SEND_SEQ2", stage: "SEQ1_SENT", bodyField: "email2", nextStage: "SEQ2_SENT", nextAction: "SEND_SEQ3", nextDelayDays: 2, label: "Day 2" },
  { action: "SEND_SEQ3", stage: "SEQ2_SENT", bodyField: "email3", nextStage: "SEQ3_SENT", nextAction: "NONE", nextDelayDays: 0, label: "Day 4" },
];

// Cohorts 5 to 7 follow the Thursday / Saturday / Wednesday / Friday rhythm as gaps, so a
// cohort that starts on another day keeps the same spacing: bump 2 days after Email 1,
// no-ask email 4 days after the bump, LinkedIn request 2 days after that. Weekends count.
const WEEKLY_CADENCE_COHORTS = ["COHORT_5", "COHORT_6", "COHORT_7"];
const WEEKLY_GAP_DAYS: Record<string, number> = { SEND_SEQ1: 2, SEND_SEQ2: 4, SEND_SEQ3: 2 };

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
  cohort?: string;
  linkedinUrl?: string;
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

type Replies = { byAddress: Map<string, string>; byDomain: Map<string, string> };

const domainOf = (address: string): string => address.split("@")[1] || "";

// The sending address is always in Reply-To, so every real reply also lands in Resend inbound.
async function inboundReplies(): Promise<Replies> {
  const byAddress = new Map<string, string>();
  const byDomain = new Map<string, string>();
  let after = "";
  for (let page = 0; page < 50; page++) {
    const res = await resend("GET", "/emails/receiving?limit=100" + (after ? "&after=" + after : ""));
    if (res.status !== 200) throw new Error("Resend inbound list " + res.status);
    const emails: any[] = res.data.data || [];
    for (const email of emails) {
      if (AUTO_REPLY_SUBJECT.test(email.subject || "")) continue;
      const from = (String(email.from || "").match(/<([^>]+)>/)?.[1] || String(email.from || "")).trim().toLowerCase();
      const domain = domainOf(from);
      if (!domain || OWN_DOMAINS.includes(domain)) continue;
      const seen = `${from} on ${String(email.created_at).slice(0, 10)}: "${email.subject || ""}"`;
      if (!byAddress.has(from)) byAddress.set(from, seen);
      if (!SHARED_MAIL_DOMAINS.includes(domain) && !byDomain.has(domain)) byDomain.set(domain, seen);
    }
    if (!res.data.has_more || !emails.length) break;
    after = emails[emails.length - 1].id;
  }
  return { byAddress, byDomain };
}

type DomainStats = { cap: number; sentToday: Map<string, number>; paused: Map<string, string> };
let domainStats: DomainStats | null = null;

const easternDate = (date: Date): string => date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const increment = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) || 0) + 1);

// Built once per run from Resend's sent list: today's count per sending domain, and domains whose recent
// bounce or complaint record means they should rest.
async function loadDomainStats(): Promise<DomainStats> {
  if (domainStats) return domainStats;
  const now = new Date();
  const today = easternDate(now);
  const windowStart = easternDate(new Date(now.getTime() - BOUNCE_WINDOW_DAYS * 24 * 60 * 60 * 1000));
  let cap = 0;
  for (const [from, value] of DOMAIN_DAILY_CAPS) if (today >= from) cap = value;
  const sentToday = new Map<string, number>();
  const sentWindow = new Map<string, number>();
  const bounced = new Map<string, number>();
  const complained = new Map<string, number>();
  let after = "";
  for (let page = 0; page < 80; page++) {
    const res = await resend("GET", "/emails?limit=100" + (after ? "&after=" + after : ""));
    if (res.status !== 200) throw new Error("Resend sent list " + res.status);
    const emails: any[] = res.data.data || [];
    let pastWindow = false;
    for (const email of emails) {
      const day = easternDate(new Date(email.created_at));
      if (day < windowStart) {
        pastWindow = true;
        break;
      }
      const from = (String(email.from || "").match(/<([^>]+)>/)?.[1] || String(email.from || "")).trim().toLowerCase();
      if (!ROTATION.includes(from)) continue;
      const domain = domainOf(from);
      increment(sentWindow, domain);
      if (day === today) increment(sentToday, domain);
      if (email.last_event === "bounced") increment(bounced, domain);
      if (email.last_event === "complained") increment(complained, domain);
    }
    if (pastWindow || !res.data.has_more || !emails.length) break;
    after = emails[emails.length - 1].id;
  }
  const paused = new Map<string, string>();
  for (const domain of SENDING_DOMAINS) {
    const sent = sentWindow.get(domain) || 0;
    const bounces = bounced.get(domain) || 0;
    if (complained.get(domain)) paused.set(domain, `${domain} paused: spam complaint in the last ${BOUNCE_WINDOW_DAYS} days`);
    else if (bounces >= BOUNCE_PAUSE_COUNT || (sent >= BOUNCE_PAUSE_MIN_SENDS && bounces / sent > BOUNCE_PAUSE_RATE))
      paused.set(domain, `${domain} paused: ${bounces}/${sent} bounced in the last ${BOUNCE_WINDOW_DAYS} days`);
  }
  domainStats = { cap, sentToday, paused };
  return domainStats;
}

const domainBlock = (stats: DomainStats, domain: string): string | null =>
  stats.paused.get(domain) || ((stats.sentToday.get(domain) || 0) >= stats.cap ? `${domain} at today's cap of ${stats.cap}` : null);

// A new thread starts from the lead's usual rotation slot, or the next address whose domain still has room.
async function pickDay0Sender(personId: string, emailsSent: number): Promise<string | null> {
  const stats = await loadDomainStats();
  const start = (hashId(personId) + emailsSent) % ROTATION.length;
  for (let offset = 0; offset < ROTATION.length; offset++) {
    const address = ROTATION[(start + offset) % ROTATION.length];
    if (!domainBlock(stats, domainOf(address))) return address;
  }
  return null;
}

// Follow-ups must come from the thread's address, so a capped or paused domain holds them until it has room.
async function followUpBlock(fromEmail: string): Promise<string | null> {
  return domainBlock(await loadDomainStats(), domainOf(fromEmail));
}

const recordSend = (fromEmail: string) => {
  if (domainStats) increment(domainStats.sentToday, domainOf(fromEmail));
};

const withFooter = (bodyText: string) => ({
  text: `${bodyText}\n\n--\n${FOOTER_TEXT}`,
  html:
    textToHtml(bodyText) +
    `\n<p style="margin:16px 0 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.4;color:#888">${FOOTER_TEXT.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`,
});

const replyFrom = (replies: Replies, email?: string): string | undefined => {
  const address = (email || "").toLowerCase();
  return replies.byAddress.get(address) || replies.byDomain.get(domainOf(address));
};

async function duePeople(stage: Stage): Promise<Person[]> {
  const data = await twenty(`query {
    campaign1People(
      filter: { nextAction: { eq: ${stage.action} }, sequenceStage: { eq: ${stage.stage} } }
      first: 100
    ) {
      edges { node {
        id name email companyName specificWorkflow emailsSent
        lastSentFrom lastMessageId nextActionDue sequenceStage nextAction cohort linkedinUrl
      } }
    }
  }`);
  return data.campaign1People.edges.map((e: any) => e.node);
}

async function cohortRecord(name: string, email: string): Promise<any | null> {
  const data = await twenty(
    `query FindCohort($name: String!) {
      c1: campaign1CohortOnes(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email placeholders } }
      }
      c2: campaign1CohortTwos(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email placeholders } }
      }
      c3: campaign1CohortThrees(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email placeholders } }
      }
      c4: campaign1CohortFours(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email placeholders } }
      }
      c5: campaign1CohortFives(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email linkedinNote placeholders } }
      }
      c6: campaign1CohortSixes(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email linkedinNote placeholders } }
      }
      c7: campaign1CohortSevens(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email linkedinNote placeholders } }
      }
      pilot: campaign1CohortPilots(filter: { name: { eq: $name } }, first: 1) {
        edges { node { id name day0Email day4Email day10Email placeholders } }
      }
    }`,
    { name },
  );
  const candidates = [data.c1, data.c2, data.c3, data.c4, data.c5, data.c6, data.c7, data.pilot]
    .map((r: any) => r.edges[0]?.node)
    .filter(Boolean);
  // Copy records are looked up by display name, which can repeat across cohorts
  // (e.g. two practices with a "Dr. Smith"), so prefer the one addressed to this person.
  const target = (email || "").toLowerCase();
  return candidates.find((c: any) => (c.placeholders?.email || "").toLowerCase() === target) || candidates[0] || null;
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

// Follow-ups keep the time of day of the send that scheduled them, so each cohort (and the
// spacing between its emails) stays in its own slot; the cron runs every few minutes.
function nextDueDate(delayDays: number): string {
  const d = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
  d.setUTCSeconds(0, 0);
  // Follow-ups land on a weekday morning, never Saturday or Sunday.
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function dueAfterGap(gapDays: number): string {
  const d = new Date(Date.now() + gapDays * 24 * 60 * 60 * 1000);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

const usesWeeklyCadence = (person: Person): boolean => WEEKLY_CADENCE_COHORTS.includes(person.cohort || "");

async function createLinkedInTask(person: Person, note: string, dueAt: string): Promise<void> {
  const body = [
    `Send a LinkedIn connection request to ${person.name} (${person.companyName || "their practice"}).`,
    person.linkedinUrl ? `Profile: ${person.linkedinUrl}` : "No LinkedIn URL on record; search by name and practice.",
    note ? `Note to include:\n\n${note}` : "No note on the cohort record; keep it short and mention the emails.",
    "If they accept, reply only with thanks for connecting. Do not pitch.",
  ].join("\n\n");
  const task = await twenty(
    `mutation CreateTask($data: TaskCreateInput!) { createTask(data: $data) { id } }`,
    { data: { title: `LinkedIn request: ${person.name}`, bodyV2: { markdown: body }, dueAt, status: "TODO" } },
  );
  await twenty(
    `mutation LinkTask($data: TaskTargetCreateInput!) { createTaskTarget(data: $data) { id } }`,
    { data: { taskId: task.createTask.id, targetCampaign1PersonId: person.id } },
  );
}

async function sendOne(stage: Stage, person: Person, replies: Replies, dryRun: boolean): Promise<{ ok: boolean; note: string }> {
  const reply = replyFrom(replies, person.email);
  if (reply) {
    if (!dryRun) {
      await twenty(
        `mutation StopPerson($id: ID!, $data: Campaign1PersonUpdateInput!) {
          updateCampaign1Person(id: $id, data: $data) { id }
        }`,
        { id: person.id, data: { sequenceStage: "REPLIED", nextAction: "NONE" } },
      );
    }
    return { ok: false, note: `reply from ${reply}; marked REPLIED` };
  }

  const cohort = await cohortRecord(person.name || "", person.email || "");
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
    fromEmail = (await pickDay0Sender(person.id, person.emailsSent || 0)) || "";
    if (!fromEmail) return { ok: false, note: "held: every sending domain is capped or paused today" };
  } else {
    if (!person.lastMessageId) return { ok: false, note: "no previous message id to thread on" };
    const prev = await resend("GET", "/emails/" + person.lastMessageId);
    if (prev.status !== 200) return { ok: false, note: "previous email not found in Resend: " + prev.status };
    const stopStage = { bounced: "BOUNCED", complained: "OPTED_OUT" }[prev.data.last_event as string];
    if (stopStage) {
      if (!dryRun) {
        await twenty(
          `mutation StopPerson($id: ID!, $data: Campaign1PersonUpdateInput!) {
            updateCampaign1Person(id: $id, data: $data) { id }
          }`,
          { id: person.id, data: { sequenceStage: stopStage, nextAction: "NONE" } },
        );
      }
      return { ok: false, note: `previous email ${prev.data.last_event}; marked ${stopStage}` };
    }
    const threadSubject: string = prev.data.subject || "";
    subject = threadSubject.startsWith("Re:") ? threadSubject : "Re: " + threadSubject;
    inReplyTo = prev.data.message_id || "";
    const fm = String(prev.data.from || "").match(/<([^>]+)>/);
    if (fm) fromEmail = fm[1];
    bodyText = stored || genericBody(stage, person, placeholders);
    if (fromEmail) {
      const block = await followUpBlock(fromEmail);
      if (block) return { ok: false, note: `held: ${block}` };
    }
  }

  if (!fromEmail) return { ok: false, note: "no sender address" };
  if (!bodyText) return { ok: false, note: "no body" };
  if (/\[[^\]]+\]/.test(bodyText)) return { ok: false, note: "unresolved [bracket] in body" };

  const payload: any = {
    from: `${SENDER_NAME} <${fromEmail}>`,
    to: [person.email],
    reply_to: [fromEmail, ...REPLY_TO],
    subject,
    ...withFooter(bodyText),
  };
  if (inReplyTo) payload.headers = { "In-Reply-To": inReplyTo, References: inReplyTo };

  const weekly = usesWeeklyCadence(person);
  const nextDue = weekly ? dueAfterGap(WEEKLY_GAP_DAYS[stage.action]) : nextDueDate(stage.nextDelayDays);

  if (dryRun) {
    recordSend(fromEmail);
    return { ok: true, note: `DRY ${stage.label} from ${fromEmail}; subject "${subject}"; threaded ${inReplyTo ? "yes" : "no"}; body ${bodyText.length} chars; next due ${nextDue}` };
  }

  const sent = await resend("POST", "/emails", payload);
  if (sent.status !== 200 || !sent.data?.id) {
    return { ok: false, note: "Resend " + sent.status + " " + JSON.stringify(sent.data) };
  }
  recordSend(fromEmail);

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
        nextActionDue: nextDue,
        lastSentFrom: fromEmail,
        lastMessageId: sent.data.id,
      },
    },
  );
  if (weekly && stage.action === "SEND_SEQ3") {
    await createLinkedInTask(person, (cohort?.linkedinNote || "").trim(), nextDue);
  }
  return { ok: true, note: `${stage.label} from ${fromEmail} (${sent.data.id})` };
}

// Filters and sorts by due time in the query: with several cohorts queued, the first 100 at a stage are not
// necessarily the ones due now.
async function campaign2DuePeople(stage: Stage, now: Date, ignoreDue: boolean): Promise<any[]> {
  const cohorts = Object.keys(CAMPAIGN2_COPY_RELATION);
  const copyFields = Object.values(CAMPAIGN2_COPY_RELATION)
    .map((relation) => `${relation} { edges { node { id subjectLine email1 email2 email3 } } }`)
    .join(" ");
  const data = await twenty(`query {
    campaign2People(
      filter: {
        nextAction: { eq: ${stage.action} }
        sequenceStage: { eq: ${stage.stage} }
        cohort: { in: [${cohorts.join(", ")}] }
        ${ignoreDue ? "" : `or: [{ nextActionDue: { lte: "${now.toISOString()}" } }, { nextActionDue: { is: NULL } }]`}
      }
      orderBy: [{ nextActionDue: AscNullsFirst }]
      first: 100
    ) {
      edges { node { id name email cohort emailsSent lastSentFrom lastMessageId nextActionDue ${copyFields} } }
    }
  }`);
  return data.campaign2People.edges.map((e: any) => e.node);
}

async function updateCampaign2Person(id: string, data: Record<string, unknown>): Promise<void> {
  await twenty(
    `mutation UpdatePerson($id: ID!, $data: Campaign2PersonUpdateInput!) {
      updateCampaign2Person(id: $id, data: $data) { id }
    }`,
    { id, data },
  );
}

type SequenceCopy = { subjectLine?: string; email1?: string; email2?: string; email3?: string };

// Campaigns 2 and 3 share the send path; they differ only in where the copy lives and which object is updated.
async function sendSequence(
  campaign: string,
  stage: Stage,
  person: any,
  copy: SequenceCopy | undefined,
  update: (id: string, data: Record<string, unknown>) => Promise<void>,
  replies: Replies,
  dryRun: boolean,
): Promise<{ ok: boolean; note: string }> {
  const reply = replyFrom(replies, person.email);
  if (reply) {
    if (!dryRun) await update(person.id, { sequenceStage: "REPLIED", nextAction: "NONE" });
    return { ok: false, note: `reply from ${reply}; marked REPLIED` };
  }

  const bodyText: string = ((copy as any)?.[stage.bodyField] || "").trim();
  let subject = "";
  let fromEmail = person.lastSentFrom || "";
  let inReplyTo = "";

  if (stage.label === "Day 0") {
    subject = (copy?.subjectLine || "").trim();
    if (!subject) return { ok: false, note: "no subject line" };
    fromEmail = (await pickDay0Sender(person.id, person.emailsSent || 0)) || "";
    if (!fromEmail) return { ok: false, note: "held: every sending domain is capped or paused today" };
  } else {
    if (!person.lastMessageId) return { ok: false, note: "no previous message id to thread on" };
    const prev = await resend("GET", "/emails/" + person.lastMessageId);
    if (prev.status !== 200) return { ok: false, note: "previous email not found in Resend: " + prev.status };
    const stopStage = { bounced: "BOUNCED", complained: "OPTED_OUT" }[prev.data.last_event as string];
    if (stopStage) {
      if (!dryRun) await update(person.id, { sequenceStage: stopStage, nextAction: "NONE" });
      return { ok: false, note: `previous email ${prev.data.last_event}; marked ${stopStage}` };
    }
    const threadSubject: string = prev.data.subject || "";
    subject = threadSubject.startsWith("Re:") ? threadSubject : "Re: " + threadSubject;
    inReplyTo = prev.data.message_id || "";
    const fm = String(prev.data.from || "").match(/<([^>]+)>/);
    if (fm) fromEmail = fm[1];
    if (fromEmail) {
      const block = await followUpBlock(fromEmail);
      if (block) return { ok: false, note: `held: ${block}` };
    }
  }

  if (!fromEmail) return { ok: false, note: "no sender address" };
  if (!bodyText) return { ok: false, note: `no ${stage.bodyField}` };
  if (/\[[^\]]+\]/.test(bodyText)) return { ok: false, note: "unresolved [bracket] in body" };

  const payload: any = {
    from: `${SENDER_NAME} <${fromEmail}>`,
    to: [person.email],
    reply_to: [fromEmail, ...REPLY_TO],
    subject,
    ...withFooter(bodyText),
  };
  if (inReplyTo) payload.headers = { "In-Reply-To": inReplyTo, References: inReplyTo };
  const nextDue = stage.nextAction === "NONE" ? null : nextDueDate(stage.nextDelayDays);

  if (dryRun) {
    recordSend(fromEmail);
    return { ok: true, note: `DRY ${campaign} ${stage.label} from ${fromEmail}; subject "${subject}"; threaded ${inReplyTo ? "yes" : "no"}; body ${bodyText.length} chars; next due ${nextDue}` };
  }

  const sent = await resend("POST", "/emails", payload);
  if (sent.status !== 200 || !sent.data?.id) {
    return { ok: false, note: "Resend " + sent.status + " " + JSON.stringify(sent.data) };
  }
  recordSend(fromEmail);
  await update(person.id, {
    sequenceStage: stage.nextStage,
    emailsSent: (person.emailsSent || 0) + 1,
    nextAction: stage.nextAction,
    nextActionDue: nextDue,
    lastSentFrom: fromEmail,
    lastMessageId: sent.data.id,
  });
  return { ok: true, note: `${campaign} ${stage.label} from ${fromEmail} (${sent.data.id})` };
}

const sendCampaign2 = (stage: Stage, person: any, replies: Replies, dryRun: boolean) =>
  sendSequence("C2", stage, person, person[CAMPAIGN2_COPY_RELATION[person.cohort]]?.edges[0]?.node, updateCampaign2Person, replies, dryRun);

async function campaign3DuePeople(stage: Stage, now: Date, ignoreDue: boolean): Promise<any[]> {
  const data = await twenty(`query {
    campaign3People(
      filter: {
        nextAction: { eq: ${stage.action} }
        sequenceStage: { eq: ${stage.stage} }
        cohort: { in: [${CAMPAIGN3_COHORTS.join(", ")}] }
        researchStatus: { eq: VERIFIED }
        emailVerification: { eq: VALID }
        ${ignoreDue ? "" : `or: [{ nextActionDue: { lte: "${now.toISOString()}" } }, { nextActionDue: { is: NULL } }]`}
      }
      orderBy: [{ nextActionDue: AscNullsFirst }]
      first: 100
    ) {
      edges { node { id name email cohort emailsSent lastSentFrom lastMessageId nextActionDue subjectLine email1 email2 email3 } }
    }
  }`);
  return data.campaign3People.edges.map((e: any) => e.node);
}

async function updateCampaign3Person(id: string, data: Record<string, unknown>): Promise<void> {
  await twenty(
    `mutation UpdatePerson($id: ID!, $data: Campaign3PersonUpdateInput!) {
      updateCampaign3Person(id: $id, data: $data) { id }
    }`,
    { id, data },
  );
}

const sendCampaign3 = (stage: Stage, person: any, replies: Replies, dryRun: boolean) =>
  sendSequence("C3", stage, person, person, updateCampaign3Person, replies, dryRun);

export const main = async (params: { dryRun?: boolean | string; ignoreDue?: boolean | string }) => {
  const dryRun = params?.dryRun === true || params?.dryRun === "true";
  const ignoreDue = params?.ignoreDue === true || params?.ignoreDue === "true";
  const now = new Date();
  const lines: string[] = [`Run at ${now.toISOString()}${dryRun ? " (dry run, nothing sent)" : ""}${ignoreDue ? " (due dates ignored)" : ""}`];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  domainStats = null;

  let replies: Replies;
  try {
    replies = await inboundReplies();
  } catch (err: any) {
    lines.push(`Nothing sent: could not read replies from Resend (${err.message})`);
    return { sent, skipped, failed: 1, report: lines.join("\n") };
  }
  lines.push(`Replies on file: ${replies.byAddress.size} addresses, ${replies.byDomain.size} practice domains`);

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
        const r = await sendOne(stage, person, replies, dryRun);
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

  const sequences = [
    { name: "Campaign 2", stages: CAMPAIGN2_STAGES, due: campaign2DuePeople, send: sendCampaign2 },
    { name: "Campaign 3", stages: CAMPAIGN3_STAGES, due: campaign3DuePeople, send: sendCampaign3 },
  ];
  for (const sequence of sequences) {
    for (const stage of sequence.stages) {
      let people: any[] = [];
      try {
        people = await sequence.due(stage, now, ignoreDue);
      } catch (err: any) {
        lines.push(`${sequence.name} ${stage.label}: query failed: ${err.message}`);
        failed++;
        continue;
      }
      const due = people.filter((p) => p.email && (ignoreDue || !p.nextActionDue || new Date(p.nextActionDue) <= now));
      lines.push(`${sequence.name} ${stage.label}: ${people.length} at stage, ${due.length} due`);

      for (const person of due) {
        if (sent >= MAX_SENDS_PER_RUN) {
          lines.push(`cap of ${MAX_SENDS_PER_RUN} sends reached; remaining contacts stay due for tomorrow`);
          break;
        }
        try {
          const r = await sequence.send(stage, person, replies, dryRun);
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
  }

  if (domainStats) {
    const stats: DomainStats = domainStats;
    lines.push(`Domain cap today: ${stats.cap}/domain. Sent today: ${SENDING_DOMAINS.map((domain) => `${domain} ${stats.sentToday.get(domain) || 0}`).join(", ")}`);
    for (const reason of stats.paused.values()) lines.push(`PAUSED ${reason}`);
  }
  return { sent, skipped, failed, report: lines.join("\n") };
};
