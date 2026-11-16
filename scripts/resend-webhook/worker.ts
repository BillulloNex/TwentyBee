// Resend inbound webhook: when a campaign lead replies, stop their sequence in Twenty,
// hold colleagues at the same company, and alert the BeeNex Sales group on Telegram.

type Env = {
  TWENTY_API_URL: string;
  TWENTY_APP_URL: string;
  TWENTY_API_TOKEN: string;
  RESEND_API_KEY: string;
  RESEND_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_THREAD_ID: string;
};

type Campaign = { label: string; plural: string; singular: string; typeName: string };

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  companyName: string | null;
  jobTitle: string | null;
  sequenceStage: string | null;
  nextAction: string | null;
  notes: string | null;
  emailsSent: number | null;
  campaign: Campaign;
};

type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string | null;
  html: string | null;
  message_id: string;
  created_at: string;
  headers: Record<string, string | string[]>;
};

type ReplyKind = 'REPLY' | 'NEGATIVE' | 'OOO' | 'BOUNCE';

const CAMPAIGNS: Campaign[] = [1, 2, 3, 4].map((number) => ({
  label: `Campaign ${number}`,
  plural: `campaign${number}People`,
  singular: `campaign${number}Person`,
  typeName: `Campaign${number}Person`,
}));

const SENDING_DOMAINS = [
  'beenex.company', 'beenex.digital', 'beenex.cloud', 'beenex.space',
  'beenex.info', 'beenex.solutions', 'beenex.tech', 'beenex.org', 'getbeenex.com',
];
const TEAM_DOMAINS = [...SENDING_DOMAINS, 'beenex.ai', 'billullo.com'];

const FREE_MAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com',
  'me.com', 'msn.com', 'live.com', 'comcast.net', 'protonmail.com', 'proton.me',
];

const TERMINAL_STAGES = ['REPLIED', 'BOOKED', 'OPTED_OUT', 'BOUNCED', 'WRONG_PERSON', 'CLOSED'];
const LEAD_FIELDS = 'id name email companyName jobTitle sequenceStage nextAction notes emailsSent';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const emailAddressOf = (value: string) =>
  (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();

const displayNameOf = (value: string) => {
  const name = value.match(/^\s*"?([^"<]+?)"?\s*</)?.[1];
  return name ? name.trim() : emailAddressOf(value);
};

const domainOf = (email: string) => email.split('@')[1] ?? '';

const headerValue = (headers: ReceivedEmail['headers'], name: string) => {
  const value = headers?.[name];
  return Array.isArray(value) ? value.join(', ') : (value ?? '');
};

const addressesInHeader = (headerText: string) =>
  [...headerText.matchAll(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g)].map((match) => match[0].toLowerCase());

const easternTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
  }) + ' ET';

// Our emails quote a "reply no thanks" footer, so only the lead's own words may be classified.
const newPartOf = (text: string) => {
  const cutPatterns = [
    /\n[ \t]*On [^\n]*(?:\n[^\n]*)?wrote:/,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\n_{5,}/,
    /\nFrom: [^\n]+\n(?:Sent|Date): /,
    /\n\*?--\*?[ \t]*\n/,
  ];
  let cutAt = text.length;
  for (const pattern of cutPatterns) {
    const match = pattern.exec(text);
    if (match && match.index < cutAt) cutAt = match.index;
  }
  return text
    .slice(0, cutAt)
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const classifyReply = (email: ReceivedEmail, newPart: string): ReplyKind => {
  const sender = emailAddressOf(email.from);
  const subject = (email.subject ?? '').toLowerCase();
  if (/^(mailer-daemon|postmaster)@/.test(sender) || /undeliver|delivery status notification|mail delivery fail/.test(subject)) {
    return 'BOUNCE';
  }
  const autoSubmitted = headerValue(email.headers, 'auto-submitted').toLowerCase();
  const precedence = headerValue(email.headers, 'precedence').toLowerCase();
  if (
    (autoSubmitted && autoSubmitted !== 'no') ||
    /auto_reply|auto-reply/.test(precedence) ||
    headerValue(email.headers, 'x-autoreply') ||
    headerValue(email.headers, 'x-autorespond') ||
    /automatic reply|auto[- ]?reply|out of (the )?office/.test(subject)
  ) {
    return 'OOO';
  }
  const body = newPart.toLowerCase();
  if (/out of (the )?office|currently away|on vacation|on leave|limited access to email/.test(body)) return 'OOO';
  if (/not interested|no thanks|no thank you|unsubscribe|remove me|stop emailing|wrong person|don't contact|do not contact/.test(body)) {
    return 'NEGATIVE';
  }
  return 'REPLY';
};

const verifySignature = async (request: Request, rawBody: string, secret: string) => {
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return false;
  if (Math.abs(Date.now() / 1000 - Number(svixTimestamp)) > 600) return false;

  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${svixId}.${svixTimestamp}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return svixSignature.split(' ').some((part) => part.split(',')[1] === expected);
};

const queryTwenty = async (env: Env, query: string, variables: Record<string, unknown>) => {
  const response = await fetch(env.TWENTY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TWENTY_API_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await response.json()) as { data?: Record<string, any>; errors?: unknown };
  if (json.errors) console.log('[twenty] errors', JSON.stringify(json.errors).slice(0, 500));
  return json.data ?? {};
};

const findLeads = async (env: Env, emailFilter: Record<string, unknown>) => {
  const results = await Promise.all(
    CAMPAIGNS.map(async (campaign) => {
      const data = await queryTwenty(
        env,
        `query FindLeads($filter: ${campaign.typeName}FilterInput) {
          ${campaign.plural}(filter: $filter, first: 25) { edges { node { ${LEAD_FIELDS} } } }
        }`,
        { filter: emailFilter },
      );
      const edges: { node: Omit<Lead, 'campaign'> }[] = data[campaign.plural]?.edges ?? [];
      return edges.map(({ node }) => ({ ...node, campaign }));
    }),
  );
  return results.flat();
};

const updateLead = (env: Env, lead: Lead, data: Record<string, unknown>) =>
  queryTwenty(
    env,
    `mutation UpdateLead($id: UUID!, $data: ${lead.campaign.typeName}UpdateInput!) {
      update${lead.campaign.typeName}(id: $id, data: $data) { id }
    }`,
    { id: lead.id, data },
  );

const appendNote = (lead: Lead, line: string) => (lead.notes ? `${lead.notes}\n${line}` : line);

const fetchReceivedEmail = async (env: Env, emailId: string) => {
  const response = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Resend receiving ${emailId}: ${response.status}`);
  return (await response.json()) as ReceivedEmail;
};

const sendTelegram = async (env: Env, html: string) => {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      message_thread_id: Number(env.TELEGRAM_THREAD_ID),
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!response.ok) throw new Error(`Telegram ${response.status}: ${(await response.text()).slice(0, 300)}`);
};

const gmailLink = (messageId: string) =>
  `https://mail.google.com/mail/#search/${encodeURIComponent(`rfc822msgid:${messageId.replace(/[<>]/g, '')}`)}`;

const recordLink = (env: Env, lead: Lead) => `${env.TWENTY_APP_URL}/object/${lead.campaign.singular}/${lead.id}`;

const pickPrimaryLead = (leads: Lead[]) =>
  [...leads].sort((first, second) => (second.emailsSent ?? 0) - (first.emailsSent ?? 0))[0];

const handleLeadReply = async (env: Env, email: ReceivedEmail, leads: Lead[]) => {
  const senderEmail = emailAddressOf(email.from);
  const newPart = newPartOf(email.text ?? '');
  const kind = classifyReply(email, newPart);
  const stamp = new Date(email.created_at).toISOString().slice(0, 16).replace('T', ' ');

  const stopped: Lead[] = [];
  for (const lead of leads) {
    if (TERMINAL_STAGES.includes(lead.sequenceStage ?? '')) continue;
    const stage = kind === 'OOO' ? 'PAUSED_OOO' : kind === 'BOUNCE' ? 'BOUNCED' : 'REPLIED';
    await updateLead(env, lead, {
      sequenceStage: stage,
      nextAction: 'NONE',
      nextActionDue: null,
      notes: appendNote(lead, `${stamp}Z reply alert: ${kind}, sequence stopped by the inbound webhook.`),
    });
    stopped.push(lead);
  }

  if (kind === 'OOO' || kind === 'BOUNCE') return { kind, stopped: stopped.length, alerted: false };

  const domain = domainOf(senderEmail);
  const held: Lead[] = [];
  if (domain && !FREE_MAIL_DOMAINS.includes(domain)) {
    const colleagues = await findLeads(env, { email: { ilike: `%@${domain}` } });
    for (const colleague of colleagues) {
      if (emailAddressOf(colleague.email ?? '') === senderEmail) continue;
      if (TERMINAL_STAGES.includes(colleague.sequenceStage ?? '')) continue;
      if (!colleague.nextAction || colleague.nextAction === 'NONE') continue;
      await updateLead(env, colleague, {
        nextAction: 'NONE',
        nextActionDue: null,
        notes: appendNote(colleague, `${stamp}Z held: ${senderEmail} at the same company replied. Was ${colleague.nextAction}.`),
      });
      held.push(colleague);
    }
  }

  const lead = pickPrimaryLead(leads);
  const replyText = newPart || '(no text, open the email)';
  const clipped = replyText.length > 1500 ? `${replyText.slice(0, 1500)}…` : replyText;
  const headline = kind === 'NEGATIVE' ? '🔔 <b>LEAD REPLIED</b> (sounds like a no)' : '🔔🔔 <b>LEAD REPLIED</b>';
  const who = [lead.name, lead.jobTitle].filter(Boolean).map((part) => escapeHtml(part as string)).join(', ');
  const lines = [
    headline,
    `<b>${who || escapeHtml(senderEmail)}</b>`,
    `${escapeHtml(lead.companyName ?? domain)} · ${lead.campaign.label}`,
    `To ${escapeHtml(email.to.join(', '))} · ${easternTime(email.created_at)}`,
    '',
    `<blockquote>${escapeHtml(clipped)}</blockquote>`,
    '',
    stopped.length ? 'Sequence stopped.' : 'Sequence was already stopped.',
    held.length ? `Held ${held.length} colleague${held.length > 1 ? 's' : ''}: ${held.map((colleague) => escapeHtml(colleague.name ?? colleague.email ?? '')).join(', ')}.` : '',
    `<a href="${gmailLink(email.message_id)}">Open in Gmail</a> · <a href="${recordLink(env, lead)}">Twenty record</a>`,
    `Reply all from Gmail so ${escapeHtml(email.to[0] ?? 'the sending address')} stays on the thread. Say "mine" here when you take it.`,
  ];
  await sendTelegram(env, lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n'));
  return { kind, stopped: stopped.length, held: held.length, alerted: true };
};

const handleTeamReply = async (env: Env, email: ReceivedEmail) => {
  const recipients = [
    ...addressesInHeader(headerValue(email.headers, 'to')),
    ...addressesInHeader(headerValue(email.headers, 'cc')),
  ].filter((address) => !TEAM_DOMAINS.includes(domainOf(address)));
  if (!recipients.length) return { team: true, alerted: false, reason: 'No lead on the thread' };

  const leads = await findLeads(env, { email: { in: recipients } });
  if (!leads.length) return { team: true, alerted: false, reason: 'Recipients are not leads' };

  const lead = pickPrimaryLead(leads);
  const sender = displayNameOf(headerValue(email.headers, 'from') || email.from);
  await sendTelegram(
    env,
    `✅ <b>${escapeHtml(sender)}</b> answered ${escapeHtml(lead.name ?? lead.email ?? '')} (${escapeHtml(lead.companyName ?? '')}) · ${easternTime(email.created_at)}`,
  );
  return { team: true, alerted: true };
};

const handleUnknownReply = async (env: Env, email: ReceivedEmail) => {
  const newPart = newPartOf(email.text ?? '');
  const kind = classifyReply(email, newPart);
  if (kind === 'OOO' || kind === 'BOUNCE') return { alerted: false, reason: 'Automated' };
  const clipped = newPart.length > 800 ? `${newPart.slice(0, 800)}…` : newPart;
  await sendTelegram(
    env,
    [
      '🔔 <b>Reply from someone not in our lead lists</b>',
      `${escapeHtml(email.from)} · ${easternTime(email.created_at)}`,
      `Subject: ${escapeHtml(email.subject ?? '')}`,
      '',
      `<blockquote>${escapeHtml(clipped || '(no text)')}</blockquote>`,
      `<a href="${gmailLink(email.message_id)}">Open in Gmail</a>. Could be a forward or an assistant.`,
    ].join('\n'),
  );
  return { alerted: true, unknownSender: true };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const rawBody = await request.text();
    if (!(await verifySignature(request, rawBody, env.RESEND_WEBHOOK_SECRET))) {
      console.log('[webhook] signature check failed');
      return new Response('Invalid signature', { status: 401 });
    }

    try {
      const payload = JSON.parse(rawBody) as { type: string; data: { email_id?: string; id?: string } };
      if (payload.type !== 'email.received') return Response.json({ ok: true, skipped: payload.type });

      const emailId = payload.data.email_id ?? payload.data.id;
      if (!emailId) return Response.json({ ok: true, skipped: 'No email id' });
      const email = await fetchReceivedEmail(env, emailId);
      const senderEmail = emailAddressOf(email.from);
      console.log('[webhook] from', senderEmail, 'subject', email.subject);

      if (TEAM_DOMAINS.includes(domainOf(senderEmail))) {
        const isReply = /^\s*re:/i.test(email.subject ?? '');
        return Response.json({ ok: true, ...(isReply ? await handleTeamReply(env, email) : { skipped: 'Team, not a reply' }) });
      }

      const leads = await findLeads(env, { email: { ilike: senderEmail } });
      if (leads.length) return Response.json({ ok: true, ...(await handleLeadReply(env, email, leads)) });

      if (/^\s*re:/i.test(email.subject ?? '')) return Response.json({ ok: true, ...(await handleUnknownReply(env, email)) });

      return Response.json({ ok: true, skipped: 'Not a lead, not a reply' });
    } catch (error) {
      console.log('[webhook] error', (error as Error).message);
      return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
    }
  },
};
