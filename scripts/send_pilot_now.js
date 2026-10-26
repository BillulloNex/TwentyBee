const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TWENTY_API_TOKEN = process.env.TWENTY_API_KEY;
const TWENTY_API_URL = 'https://20.beenex.cloud/graphql';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ACCOUNTS = [
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

const SENDER_NAME = "Javier Sanchez";
const SENDER_TITLE = "Solutions Architect, BeeNex";
const SENDER_ADDRESS = "Melbourne, FL";
const BOOKING_URL = "https://meetings.hubspot.com/beenex/social-bloom-architecture-fit-call";

const hashId = (s) => {
  let h = 0;
  for (const ch of (s || "")) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
};

const companyShort = (s) => {
  const t = (s || "").replace(/,?\s*(LLC|L\.L\.C\.|P\.C\.|PLLC|Inc\.?|Incorporated|Ltd\.?|P\.?A)\.?$/i, "").trim();
  return t || "the practice";
};

const firstNameOf = (s) => {
  const t = (s || "").replace(/^(Dr\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, "").trim();
  return (t.split(/[\s,]+/)[0] || "there");
};

async function getCohortPlaceholders(name) {
  try {
    const res = await fetch(TWENTY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + TWENTY_API_TOKEN,
      },
      body: JSON.stringify({
        query: `query FindCohort($name: String!) {
          pilot: campaign1CohortPilots(filter: { name: { eq: $name } }, first: 1) {
            edges { node { id name day0Email day4Email day10Email placeholders } }
          }
        }`,
        variables: { name },
      }),
    });
    const json = await res.json();
    return json?.data?.pilot?.edges?.[0]?.node?.placeholders || {};
  } catch {
    return {};
  }
}

async function getReadyPilotPeople() {
  const res = await fetch(TWENTY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + TWENTY_API_TOKEN,
    },
    body: JSON.stringify({
      query: `query {
        campaign1People(
          filter: {
            cohort: { eq: "PILOT" },
            sequenceStage: { eq: "READY" },
            nextAction: { eq: "SEND_SEQ1" }
          },
          first: 30
        ) {
          edges {
            node {
              id
              name
              email
              companyName
              specificWorkflow
              verifiedFact
              relatedHandoff
              landingPageUrl
              templateVersion
              matchedClient
              verifiedResult
              emailsSent
            }
          }
        }
      }`,
    }),
  });
  const json = await res.json();
  return json?.data?.campaign1People?.edges?.map(e => e.node) || [];
}

async function updatePersonRecord(id, fields) {
  const res = await fetch(TWENTY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + TWENTY_API_TOKEN,
    },
    body: JSON.stringify({
      query: `mutation UpdatePerson($id: ID!, $data: Campaign1PersonUpdateInput!) {
        updateCampaign1Person(id: $id, data: $data) {
          id
          name
          sequenceStage
          nextAction
          emailsSent
        }
      }`,
      variables: { id, data: fields },
    }),
  });
  const json = await res.json();
  return json?.data?.updateCampaign1Person;
}

function composeEmail(r, ph) {
  const co = companyShort(r.companyName || ph.Practice);
  const wf = r.specificWorkflow || ph.specificWorkflow || "workflow";
  const first = firstNameOf(r.name);
  const landingPageUrl = ph.landingPageUrl || r.landingPageUrl || "";
  const verifiedFact = ph.verifiedFact || r.verifiedFact || "";
  const relatedHandoff = ph.relatedHandoff || r.relatedHandoff || "";
  const matchedClient = ph.matchedClient || r.matchedClient || "";
  const verifiedResult = ph.verifiedResult || r.verifiedResult || "";

  const p = (text) => `<p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#333">${text}</p>`;
  const spacer = () => `<p style="margin:0 0 12px 0">&nbsp;</p>`;
  const link = (text, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8">${text}</a>`;

  const subject = `${wf} at ${co}`;
  const htmlParts = [
    p(`Hi ${first},`),
    spacer(),
    p(`I saw that ${co} ${verifiedFact}. I’m curious how your team handles ${relatedHandoff} today.`),
    spacer(),
  ];

  if (r.templateVersion === "A" && matchedClient) {
    htmlParts.push(
      p(`BeeNex helped ${matchedClient} ${verifiedResult}. Here is ${link("how we approached it", landingPageUrl)}.`),
      spacer()
    );
  } else {
    htmlParts.push(
      p(`BeeNex maps one priority workflow and the systems around it, then scopes secure integration or automation only where it is useful. Here is ${link("what that looks like for practices like yours", landingPageUrl)}.`),
      spacer()
    );
  }

  htmlParts.push(
    p("We start by mapping one priority workflow and the systems around it, before scoping any integration or automation."),
    spacer(),
    p(`What day and time next week would work for a 30 minute Architecture Fit Call about ${wf} at ${co}?`),
    spacer(),
    p("Best,"),
    p(SENDER_NAME),
    p(SENDER_TITLE),
    p(SENDER_ADDRESS),
    spacer(),
    p('If this isn\'t relevant, reply "no thanks" and I won\'t follow up.')
  );

  const html = htmlParts.join("\n");
  const count = typeof r.emailsSent === "number" ? r.emailsSent : 0;
  const idx = (hashId(r.id) + count) % ACCOUNTS.length;
  const fromEmail = ACCOUNTS[idx];

  const now = new Date();
  const nextDue = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  nextDue.setUTCHours(13, 0, 0, 0);

  return {
    fromEmail,
    fromFormatted: `${SENDER_NAME} <${fromEmail}>`,
    to: r.email,
    subject,
    html,
    nextDue: nextDue.toISOString(),
  };
}

async function sendViaResend(emailPayload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + RESEND_API_KEY,
    },
    body: JSON.stringify({
      from: emailPayload.fromFormatted,
      to: [emailPayload.to],
      subject: emailPayload.subject,
      html: emailPayload.html,
      reply_to: emailPayload.fromEmail,
    }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  console.log("Fetching ready pilot prospects...");
  const people = await getReadyPilotPeople();
  const validPeople = people.filter(p => p.email && !p.email.includes("thomas") && !p.name.includes("Test"));
  console.log(`Found ${validPeople.length} ready pilot prospects to send.\n`);

  const results = [];

  for (let i = 0; i < validPeople.length; i++) {
    const person = validPeople[i];
    console.log(`[${i + 1}/${validPeople.length}] Processing ${person.name} (${person.email})...`);

    const ph = await getCohortPlaceholders(person.name);
    const emailPayload = composeEmail(person, ph);

    console.log(`   From: ${emailPayload.fromFormatted}`);
    console.log(`   Subject: "${emailPayload.subject}"`);

    // Send via Resend
    const resendResult = await sendViaResend(emailPayload);
    if (resendResult.status !== 200) {
      console.error(`   ❌ Failed to send via Resend:`, resendResult.data);
      results.push({ name: person.name, email: person.email, success: false, error: resendResult.data });
      continue;
    }

    const resendId = resendResult.data.id;
    console.log(`   ✅ Sent! Resend ID: ${resendId}`);

    // Update record in Twenty
    const updateResult = await updatePersonRecord(person.id, {
      sequenceStage: "SEQ1_SENT",
      emailsSent: (person.emailsSent || 0) + 1,
      nextAction: "SEND_SEQ2",
      nextActionDue: emailPayload.nextDue,
      lastSentFrom: emailPayload.fromEmail,
      lastMessageId: resendId,
    });

    console.log(`   ✅ Twenty CRM updated: stage=${updateResult?.sequenceStage}, nextAction=${updateResult?.nextAction}, nextDue=${emailPayload.nextDue}`);
    results.push({ name: person.name, email: person.email, success: true, resendId, from: emailPayload.fromEmail });

    // Brief pause between sends (1 second) for clean pacing
    if (i < validPeople.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log("\n==========================================");
  console.log(`Pilot Send Complete! Successfully sent: ${results.filter(r => r.success).length}/${validPeople.length}`);
  console.log("==========================================");
  fs.writeFileSync("/tmp/pilot_send_results.json", JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error("Fatal error:", err);
});
