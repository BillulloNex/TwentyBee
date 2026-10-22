// Resend Inbound Webhook → Twenty CRM Bridge
// Cloudflare Worker: receives Resend's email.received webhook,
// matches sender to campaign1Person, updates the record.

interface Env {
  TWENTY_API_URL: string;
  TWENTY_API_TOKEN: string;
  RESEND_WEBHOOK_SECRET: string;
}

const OUR_DOMAINS = [
  'beenex.company', 'beenex.digital', 'beenex.cloud', 'beenex.space',
  'beenex.info', 'beenex.solutions', 'beenex.tech', 'beenex.org', 'getbeenex.com',
];

function classifyReply(text: string): 'POSITIVE' | 'NEGATIVE' | 'OOO' | 'BOUNCE' {
  const lower = text.toLowerCase();
  if (lower.includes('delivery') && (lower.includes('fail') || lower.includes('undeliverable'))) return 'BOUNCE';
  if (lower.includes('mailer-daemon') || lower.includes('postmaster')) return 'BOUNCE';
  if (lower.includes('out of office') || lower.includes('out of the office')) return 'OOO';
  if (lower.includes('auto-reply') || lower.includes('autoreply') || lower.includes('automatic reply')) return 'OOO';
  if (lower.includes('currently away') || lower.includes('on vacation') || lower.includes('on leave')) return 'OOO';
  if (lower.includes('limited access to email')) return 'OOO';
  if (lower.includes('not interested') || lower.includes('no thanks') || lower.includes('no thank you')) return 'NEGATIVE';
  if (lower.includes('unsubscribe') || lower.includes('remove me') || lower.includes('stop emailing')) return 'NEGATIVE';
  if (lower.includes('wrong person') || lower.includes("don't contact")) return 'NEGATIVE';
  return 'POSITIVE';
}

function classificationToStage(c: string): string {
  if (c === 'OOO') return 'PAUSED_OOO';
  if (c === 'BOUNCE') return 'BOUNCED';
  return 'REPLIED';
}

async function queryTwenty(env: Env, query: string, variables: Record<string, any>) {
  console.log('[queryTwenty] URL:', env.TWENTY_API_URL);
  console.log('[queryTwenty] variables:', JSON.stringify(variables));
  const res = await fetch(env.TWENTY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.TWENTY_API_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as any;
  console.log('[queryTwenty] status:', res.status, 'response:', JSON.stringify(json).slice(0, 500));
  return json;
}

async function findCampaignPersonByEmail(env: Env, email: string) {
  const result = await queryTwenty(env,
    `query FindBySenderEmail($email: String!) {
      campaign1People(filter: { email: { eq: $email } }, first: 1) {
        edges { node { id name email companyName cohort sequenceStage nextAction } }
      }
    }`,
    { email },
  );
  return result?.data?.campaign1People?.edges?.[0]?.node || null;
}

async function updateCampaignPerson(env: Env, id: string, stage: string) {
  return queryTwenty(env,
    `mutation UpdateCampaign1Person($id: ID!, $data: Campaign1PersonUpdateInput!) {
      updateCampaign1Person(id: $id, data: $data) { id sequenceStage nextAction }
    }`,
    { id, data: { sequenceStage: stage, nextAction: 'NONE' } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const payload = await request.json() as any;
      const eventType = payload.type;
      console.log('[webhook] event:', eventType, 'payload.data keys:', Object.keys(payload.data || {}));

      if (eventType !== 'email.received') {
        return Response.json({ ok: true, skipped: true, reason: `Event: ${eventType}` });
      }

      const data = payload.data;
      const senderEmail = (data.from || '').toLowerCase();
      const textBody = data.text || data.html || '';
      console.log('[webhook] from:', senderEmail, 'subject:', data.subject);

      // Skip our own outbound
      const senderDomain = senderEmail.split('@')[1];
      if (OUR_DOMAINS.includes(senderDomain)) {
        return Response.json({ ok: true, skipped: true, reason: 'Own domain' });
      }

      // Find matching campaign person
      const contact = await findCampaignPersonByEmail(env, senderEmail);
      if (!contact) {
        return Response.json({ ok: true, skipped: true, reason: `No contact for ${senderEmail}` });
      }
      if (contact.cohort !== 'PILOT') {
        return Response.json({ ok: true, skipped: true, reason: 'Not PILOT' });
      }

      const terminalStages = ['REPLIED', 'BOOKED', 'OPTED_OUT', 'BOUNCED', 'WRONG_PERSON', 'CLOSED'];
      if (terminalStages.includes(contact.sequenceStage)) {
        return Response.json({ ok: true, skipped: true, reason: `Already: ${contact.sequenceStage}` });
      }

      const classification = classifyReply(textBody);
      const newStage = classificationToStage(classification);
      const updateResult = await updateCampaignPerson(env, contact.id, newStage);

      return Response.json({
        ok: true,
        matched: true,
        contact: contact.name,
        from: senderEmail,
        classification,
        newStage,
        updated: !!updateResult?.data,
      });
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
  },
};
