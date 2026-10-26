const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function sendTest() {
  const TWENTY_API_TOKEN = process.env.TWENTY_API_KEY;
  const TWENTY_API_URL = 'https://20.beenex.cloud/graphql';

  const record = {
    id: '318a2d56-9978-4595-9f31-b04fa2a678ce',
    name: 'Thomas (Internal Test)',
    email: 'sequence+thomas@beenex.company',
    cohort: 'PILOT',
    sequenceStage: 'READY',
    nextAction: 'SEND_SEQ1',
    nextActionDue: '2026-10-22T00:00:00.000Z',
    emailsSent: 0
  };

  const res = await fetch(TWENTY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TWENTY_API_TOKEN
    },
    body: JSON.stringify({
      query: `query FindCohort($name: String!) {
        c1: campaign1CohortOnes(filter: { name: { eq: $name } }, first: 1) {
          edges { node { id name day0Email day4Email day10Email placeholders } }
        }
      }`,
      variables: { name: record.name },
    }),
  });
  const json = await res.json();
  const c1Node = json?.data?.c1?.edges?.[0]?.node;

  function textToHtml(plainText) {
    const paragraphs = plainText.split(/\n\s*\n/);
    return paragraphs.map(para => {
      let html = para.trim().replace(/\n/g, '<br/>');
      html = html.replace(/(https?:\/\/[^\s<]+)/g, (match) => {
        let url = match;
        let trailing = '';
        const punctMatch = url.match(/[.,;:?!)]+$/);
        if (punctMatch) {
          trailing = punctMatch[0];
          url = url.slice(0, -trailing.length);
        }
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8">${url}</a>${trailing}`;
      });
      return `<p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#333">${html}</p>`;
    }).join('\n');
  }

  const raw = c1Node.day0Email.trim();
  const m = raw.match(/^Subject:\s*([^\n]+)\n+([\s\S]*)$/i);
  const subject = m[1].trim();
  const bodyText = m[2].trim();
  const html = textToHtml(bodyText);

  const resendPayload = {
    from: 'Javier Sanchez <javier@getbeenex.com>',
    to: [record.email],
    subject: subject,
    html: html,
    reply_to: 'javier@getbeenex.com'
  };

  console.log('Sending to Resend API...');
  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY
    },
    body: JSON.stringify(resendPayload)
  });

  const resendData = await resendRes.json();
  console.log('Resend Status:', resendRes.status);
  console.log('Resend Data:', resendData);
}

sendTest();
