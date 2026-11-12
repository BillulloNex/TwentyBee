// Queues Campaign 3 for the daily sender. Each sendable lead gets a weekday send pattern (the day of each of its
// three emails, Eastern) and an irregular early-morning Day 0 time in the lead's own time zone, so it is near the
// top of the inbox when they sit down. Patterns are dealt round-robin within each cohort, which spreads Day 0 over every sending day
// and gives each pattern a similar mix of cohorts to compare reply rates on. Saturday is never a sending day.
// Dry run by default: prints the plan and a per-day forecast of all three emails.
// --campaign 4 queues Campaign 4 contacts (ZeroBounce VALID, researched, drafted) the same way.
// Usage: node scripts/campaign3-schedule.mjs [--campaign 4] --start 2026-11-15 [--patterns SUN-TUE-FRI,...] [--window 6:00-8:45] [--save]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const API_URL = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud") + "/graphql";
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const SAVE = args.includes("--save");
const CAMPAIGN = option("--campaign") ?? "3";
const START = option("--start");
if (!START) throw new Error("pass --start YYYY-MM-DD (first day Day 0 emails may go out)");
// Default set is a Latin square over the six sending days: each weekday is Email 1 of one pattern, Email 2 of
// another and Email 3 of a third, so daily volume stays level and each start day can be compared.
const PATTERNS = (option("--patterns") ?? "SUN-TUE-FRI,MON-WED-SUN,TUE-THU-MON,WED-FRI-TUE,THU-SUN-WED,FRI-MON-THU").split(",");
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
for (const pattern of PATTERNS) {
  const days = pattern.split("-");
  if (days.length !== 3 || days.some((day) => !WEEKDAYS.includes(day) || day === "SAT")) throw new Error(`bad pattern ${pattern}`);
}

// Hours behind Eastern, from the state in the lead's location.
const STATE_OFFSET = {
  Alabama: 1, Alaska: 4, Arizona: 2, Arkansas: 1, California: 3, Colorado: 2, Hawaii: 5, Idaho: 2, Illinois: 1, Iowa: 1, Kansas: 1,
  Louisiana: 1, Minnesota: 1, Mississippi: 1, Missouri: 1, Montana: 2, Nebraska: 1, Nevada: 3, "New Mexico": 2, "North Dakota": 1,
  Oklahoma: 1, Oregon: 3, "South Dakota": 1, Texas: 1, Utah: 2, Washington: 3, Wisconsin: 1, Wyoming: 2,
};
const STATE_ABBREVIATIONS = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IA: "Iowa",
  KS: "Kansas", LA: "Louisiana", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NM: "New Mexico",
  ND: "North Dakota", OK: "Oklahoma", OR: "Oregon", SD: "South Dakota", TX: "Texas", UT: "Utah", WA: "Washington", WI: "Wisconsin", WY: "Wyoming",
};
const offsetFor = (location) => {
  const abbreviation = (location || "").match(/,\s*([A-Z]{2})\b/)?.[1];
  if (abbreviation) return STATE_OFFSET[STATE_ABBREVIATIONS[abbreviation]] ?? 0;
  const state = Object.keys(STATE_OFFSET).find((name) => new RegExp(`\\b${name}\\b`).test(location || "") && !/Washington, D\.?C/.test(location || ""));
  return state ? STATE_OFFSET[state] : 0;
};
const easternParts = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false }).formatToParts(date).map((part) => [part.type, part.value]));
  return { weekday: parts.weekday.toUpperCase(), hour: Number(parts.hour) % 24 };
};
// The instant that is <hour> o'clock Eastern on the given calendar day, whatever the daylight saving state.
function easternTime(day, hour, minute) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCHours(hour + 5, minute, 0, 0);
  if (easternParts(date).hour !== hour) date.setUTCHours(date.getUTCHours() - 1);
  return date;
}
const addDays = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 864e5).toISOString().slice(0, 10);
const weekdayOf = (day) => easternParts(new Date(`${day}T17:00:00Z`)).weekday;
const firstOnOrAfter = (day, weekday) => {
  for (let offset = 0; offset < 7; offset++) if (weekdayOf(addDays(day, offset)) === weekday) return addDays(day, offset);
};
const nextAfter = (day, weekday) => {
  for (let offset = 1; offset <= 7; offset++) if (weekdayOf(addDays(day, offset)) === weekday) return addDays(day, offset);
};

async function gql(query, variables) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.TWENTY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

let after = null;
const people = [];
if (CAMPAIGN === "4") {
  do {
    const data = await gql(
      `query($after: String) { campaign4People(first: 200, after: $after, filter: { researchStatus: { eq: VERIFIED }, zerobounceStatus: { eq: VALID }, sequenceStage: { eq: NOT_STARTED } }) {
        pageInfo { hasNextPage endCursor } edges { node { id name email email1 organization { city state source budgetWave } } } } }`,
      { after },
    );
    people.push(
      ...data.campaign4People.edges
        .map(({ node }) => ({ ...node, cohort: node.organization?.source || "UNKNOWN", fitStatus: node.organization?.budgetWave, location: [node.organization?.city, node.organization?.state].filter(Boolean).join(", ") }))
        .filter((person) => person.email1),
    );
    after = data.campaign4People.pageInfo.hasNextPage ? data.campaign4People.pageInfo.endCursor : null;
  } while (after);
} else do {
  const data = await gql(
    `query($after: String) { campaign3People(first: 200, after: $after, filter: { researchStatus: { eq: VERIFIED }, emailVerification: { eq: VALID }, sequenceStage: { eq: NOT_STARTED } }) {
      pageInfo { hasNextPage endCursor } edges { node { id name email cohort fitStatus location email1 } } } }`,
    { after },
  );
  people.push(...data.campaign3People.edges.map((edge) => edge.node).filter((person) => person.email1 && person.cohort));
  after = data.campaign3People.pageInfo.hasNextPage ? data.campaign3People.pageInfo.endCursor : null;
} while (after);

// Stable order (cohort, then fit, then id) so a rerun deals the same patterns.
const fitRank = { FIT: 0, MAYBE: 1 };
people.sort((a, b) => a.cohort.localeCompare(b.cohort) || (fitRank[a.fitStatus] ?? 2) - (fitRank[b.fitStatus] ?? 2) || a.id.localeCompare(b.id));
let dealt = 0;
const plan = people.map((person) => {
  const pattern = PATTERNS[dealt++ % PATTERNS.length];
  const days = pattern.split("-");
  const day0 = firstOnOrAfter(START, days[0]);
  const day1 = nextAfter(day0, days[1]);
  const day2 = nextAfter(day1, days[2]);
  return { person, pattern, days: [day0, day1, day2], offset: offsetFor(person.location) };
});

// Day 0 goes out at an irregular early-morning minute in the lead's own time zone (6:00 to 8:45 by default), so
// sends from one domain never form a round-number, evenly spaced pattern. The time is seeded by the record id,
// so a rerun produces the same schedule.
const [WINDOW_START, WINDOW_END] = (option("--window") ?? "6:00-8:45").split("-").map((time) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
});
const seeded = (text) => {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 2 ** 32;
};
for (const item of plan) {
  let localMinutes = WINDOW_START + Math.floor(seeded(item.person.id) * (WINDOW_END - WINDOW_START));
  if (localMinutes % 5 === 0) localMinutes += 2;
  item.localTime = `${Math.floor(localMinutes / 60)}:${String(localMinutes % 60).padStart(2, "0")}`;
  item.due = easternTime(item.days[0], Math.floor(localMinutes / 60) + item.offset, localMinutes % 60);
}

const forecast = new Map();
for (const item of plan) item.days.forEach((day, email) => {
  const row = forecast.get(day) ?? [0, 0, 0];
  row[email]++;
  forecast.set(day, row);
});
console.log(`${plan.length} leads queued from ${START}`);
const byPattern = {};
for (const item of plan) byPattern[item.pattern] = (byPattern[item.pattern] || 0) + 1;
console.log("per pattern", byPattern);
console.log("day         email1 email2 email3 total");
for (const [day, row] of [...forecast].sort()) console.log(`${day} ${weekdayOf(day)}  ${row.map((n) => String(n).padStart(6)).join(" ")} ${String(row.reduce((a, b) => a + b, 0)).padStart(5)}`);
for (const item of plan.slice(0, 6)) console.log(`e.g. ${item.person.name} (${item.person.location}): ${item.pattern}, Day 0 ${item.days[0]} ${item.localTime} local (${item.due.toISOString()})`);

if (!SAVE) {
  console.log("\ndry run; pass --save to queue these in Twenty (they then send automatically)");
  process.exit(0);
}
for (const item of plan) {
  await gql(`mutation($id: UUID!, $data: Campaign${CAMPAIGN}PersonUpdateInput!) { updateCampaign${CAMPAIGN}Person(id: $id, data: $data) { id } }`, {
    id: item.person.id,
    data: { sendPattern: item.pattern, sequenceStage: "READY", nextAction: "SEND_SEQ1", nextActionDue: item.due.toISOString() },
  });
}
console.log(`queued ${plan.length} leads`);
