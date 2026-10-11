import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const baseUrl = process.env.TWENTY_BASE_URL || 'https://20.beenex.cloud';
const apiKey = process.env.TWENTY_API_KEY;

if (!apiKey) {
  console.error('Missing TWENTY_API_KEY');
  process.exit(1);
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function gql(query) {
  const res = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  return res.json();
}

async function patchREST(endpoint, body) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${baseUrl}/rest/${endpoint}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (res.status === 429) {
      console.warn(`[429 Rate Limit] Backing off on ${endpoint}... attempt ${attempt}`);
      await sleep(5000 * attempt);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PATCH ${endpoint} failed (${res.status}): ${errText}`);
    }

    return res.json();
  }
}

// 1. Data Definitions
const personUpdates = [
  { name: 'Cindy Alkire', email: 'calkire@afcak.com', source: 'Arete Family Care Privacy Official notice (afcak.com)' },
  { name: 'Daniel Kim', email: 'd.kim@ruhealth.org', source: 'Riverside University Health System / UCR directory (ruhealth.org)' },
  { name: 'Prabhat Sinha', email: 'Oceanfamily5@outlook.com', source: 'Ocean Family & Geriatric Associates site (drpsinha.com)' },
  { name: 'M. Bardett Fausett', email: 'hello@originhealth.com', source: 'Origin Health practice contact (originhealth.com)' },
  { name: 'Manoucher Shahab', email: 'painfree@medwellnj.com', source: 'MedWell Center official contact (medwellnj.com)' },
  { name: 'Aboo Nasar', email: 'info@delsurhealthcare.com', source: 'Del Sur Healthcare contact (delsurhealthcare.com)' },
  { name: 'Ferdinand Panoussi', email: 'info@uhaclinic.com', source: 'Unified Health Associates contact (uhaclinic.com)' },
  { name: 'Tommy Wan', email: 'info@uhaclinic.com', source: 'Unified Health Associates contact (uhaclinic.com)' }
];

const companyUpdates = [
  { name: 'Arete Family Care', domain: 'afcak.com' },
  { name: 'MedWell LLC', domain: 'medwellnj.com' },
  { name: 'Origin Health', domain: 'originhealth.com' },
  { name: 'Palm Valley Multi-Specialty Medical Group', domain: 'palmvalleymedicalgroup.com' },
  { name: 'Ophthalmic Associates (Anchorage)', domain: 'akeyedoc.com' },
  { name: 'Island Orthopaedics', domain: 'islandorthopaedics.com' },
  { name: 'Pearl City Medical Associates', domain: 'pearlcitymedical.com' },
  { name: 'Horizon Multicare Group', domain: 'uhaclinic.com' },
  { name: 'Crystal Lake Clinic, PC', domain: 'crystallakehealthcenters.com' },
  { name: 'Ocean Family & Geriatric Associates LLC', domain: 'drpsinha.com' },
  { name: 'Albany Troy Cataract & Laser Associates', domain: 'ophthalmicconsultants.com' },
  { name: 'Del Sur Healthcare', domain: 'delsurhealthcare.com' }
];

async function run() {
  console.log('=== RUNNING LEADERSHIP WATERFALL ENRICHMENT ===');
  const results = { people: [], companies: [] };

  // --- PHASE A: UPDATE COMPANIES WITH DISCOVERED DOMAINS ---
  console.log(`\n[Phase 1] Updating ${companyUpdates.length} medical practice domains...`);
  for (const c of companyUpdates) {
    const q = `query {
      companies(filter: { name: { ilike: "%${c.name.slice(0, 15)}%" } }, first: 5) {
        edges { node { id name } }
      }
    }`;
    const compRes = await gql(q);
    const nodes = compRes.data?.companies?.edges?.map(e => e.node) || [];
    const matched = nodes.find(n => n.name.toLowerCase().includes(c.name.slice(0, 10).toLowerCase())) || nodes[0];

    if (!matched) {
      console.warn(`  [!] Company not found: ${c.name}`);
      continue;
    }

    await patchREST(`companies/${matched.id}`, {
      domainName: {
        primaryLinkLabel: c.domain,
        primaryLinkUrl: c.domain,
        secondaryLinks: []
      }
    });

    results.companies.push({ id: matched.id, name: matched.name, domain: c.domain, status: 'UPDATED' });
    console.log(`  [+] Updated Company: ${matched.name} -> ${c.domain}`);
    await sleep(700);
  }

  // --- PHASE B: UPDATE PEOPLE WITH DISCOVERED EMAILS ---
  console.log(`\n[Phase 2] Updating ${personUpdates.length} leadership contacts with emails...`);
  for (const p of personUpdates) {
    const cleanLast = p.name.split(' ').pop();
    const cleanFirst = p.name.split(' ')[0].replace(/[^a-zA-Z]/g, '');

    const q = `query {
      people(filter: { name: { lastName: { ilike: "%${cleanLast}%" } } }, first: 20) {
        edges {
          node {
            id
            name { firstName lastName }
            emails { primaryEmail }
          }
        }
      }
    }`;

    const pRes = await gql(q);
    const nodes = pRes.data?.people?.edges?.map(e => e.node) || [];
    const matched = nodes.find(n => {
      const fn = (n.name?.firstName || '').toLowerCase();
      const ln = (n.name?.lastName || '').toLowerCase();
      return ln === cleanLast.toLowerCase() && (fn.startsWith(cleanFirst.toLowerCase().slice(0, 3)) || cleanFirst.toLowerCase().startsWith(fn.slice(0, 3)));
    });

    if (!matched) {
      console.warn(`  [!] Person not found: ${p.name}`);
      continue;
    }

    await patchREST(`people/${matched.id}`, {
      emails: {
        primaryEmail: p.email,
        additionalEmails: []
      },
      emailStatus: 'VERIFIED_PUBLIC',
      emailSource: p.source
    });

    results.people.push({
      id: matched.id,
      name: `${matched.name?.firstName} ${matched.name?.lastName}`,
      email: p.email,
      emailStatus: 'VERIFIED_PUBLIC',
      source: p.source,
      status: 'ENRICHED'
    });
    console.log(`  [+] Updated Person: ${matched.name?.firstName} ${matched.name?.lastName} -> ${p.email}`);
    await sleep(700);
  }

  const outPath = path.resolve(__dirname, 'leadership_waterfall_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n=== ENRICHMENT COMPLETE! Audit log saved to ${outPath} ===`);
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
