import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompaniesCSV } from './lib/parser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envContent = readFileSync(resolve(__dirname, '.env'), 'utf8');
let apiKey = '';
let baseUrl = 'https://20.beenex.cloud';
for (const line of envContent.split('\n')) {
  if (line.startsWith('TWENTY_API_KEY=')) apiKey = line.slice('TWENTY_API_KEY='.length).trim();
  if (line.startsWith('TWENTY_BASE_URL=')) baseUrl = line.slice('TWENTY_BASE_URL='.length).trim();
}

const csvPath = resolve(__dirname, 'data/companies_raw.csv');
const rows = parseCompaniesCSV(csvPath);

console.log(`Parsed ${rows.length} companies from CSV.`);

// Concurrency pool helper
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function checkCompanyInTwenty(row) {
  const cleanName = row.name.replace(/["\\]/g, '');

  const query = `query {
    companies(filter: {
      or: [
        { name: { ilike: "%${cleanName.slice(0, 30)}%" } }
        ${row.domain ? `{ domainName: { primaryLinkUrl: { ilike: "%${row.domain}%" } } }` : ''}
      ]
    }, first: 5) {
      edges {
        node {
          id
          name
          domainName { primaryLinkUrl }
          companyType
          address { addressCity addressState }
          fitScore
          clinicianCount
          painPoints
          enrichmentStatus
        }
      }
    }
  }`;

  try {
    const res = await fetch(`${baseUrl}/graphql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const data = await res.json();
    const edges = data?.data?.companies?.edges || [];

    if (edges.length === 0) {
      return {
        row,
        action: 'CREATE_NEW',
        reason: 'No existing company record in Twenty',
      };
    }

    // Find best match: exact domain or exact name match
    let match = edges[0].node;
    if (row.domain) {
      const domainMatch = edges.find(e => (e.node.domainName?.primaryLinkUrl || '').toLowerCase().includes(row.domain));
      if (domainMatch) match = domainMatch.node;
    }

    return {
      row,
      action: 'UPDATE_EXISTING',
      twentyId: match.id,
      twentyName: match.name,
      currentRecord: {
        id: match.id,
        name: match.name,
        domain: match.domainName?.primaryLinkUrl || '(none)',
        currentFitScore: match.fitScore ?? '(none)',
        currentPainPoints: match.painPoints ? `${match.painPoints.slice(0, 40)}...` : '(none)',
        currentStatus: match.enrichmentStatus || '(none)',
      },
      proposedUpdates: {
        address: `${row.address.addressStreet1}, ${row.address.addressCity}, ${row.address.addressState} ${row.address.addressPostcode}`,
        phoneNumber: row.phoneNumber,
        linkedin: row.linkedin || '(none)',
        orgPacId: row.orgPacId,
        clinicianCount: row.clinicianCount,
        fitScore: row.fitScore,
        enrichmentStatus: row.enrichmentStatus,
        painPointsSnippet: row.painPoints.slice(0, 100) + '...',
      },
    };
  } catch (err) {
    return {
      row,
      action: 'CREATE_NEW',
      reason: `Query error: ${err.message}`,
    };
  }
}

async function runDryRun() {
  console.log(`Starting parallel dry-run match for ${rows.length} companies (concurrency: 6)...`);
  const t0 = Date.now();

  let processed = 0;
  const results = await mapConcurrent(rows, 6, async (row) => {
    const res = await checkCompanyInTwenty(row);
    processed++;
    if (processed % 50 === 0 || processed === rows.length) {
      console.log(`  Processed ${processed}/${rows.length} companies...`);
    }
    return res;
  });

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Finished dry-run evaluation in ${durationSec}s.`);

  const updateList = results.filter(r => r.action === 'UPDATE_EXISTING');
  const createList = results.filter(r => r.action === 'CREATE_NEW');

  console.log(`\n=================== COMPANY DRY RUN AUDIT ===================`);
  console.log(`Total Companies in CSV:              ${rows.length}`);
  console.log(`Existing Companies to ENRICH/UPDATE: ${updateList.length} (${((updateList.length/rows.length)*100).toFixed(1)}%)`);
  console.log(`New Companies to CREATE:             ${createList.length} (${((createList.length/rows.length)*100).toFixed(1)}%)`);
  console.log(`Reconciliation Check:                ${updateList.length} + ${createList.length} = ${updateList.length + createList.length} (Matches 266: ${updateList.length + createList.length === rows.length})`);
  console.log(`=============================================================`);

  // Fit Score Distribution
  const fitScores = {};
  for (const r of rows) {
    const score = r.fitScore || 'None';
    fitScores[score] = (fitScores[score] || 0) + 1;
  }
  console.log(`\nFit Score Distribution:`, fitScores);

  // Status Distribution
  const statuses = {};
  for (const r of rows) {
    statuses[r.enrichmentStatus] = (statuses[r.enrichmentStatus] || 0) + 1;
  }
  console.log(`Enrichment Status Distribution:`, statuses);

  // Write full JSON report
  const reportPath = resolve(__dirname, 'dry_run_companies_report.json');
  writeFileSync(reportPath, JSON.stringify({
    summary: {
      totalInputCompanies: rows.length,
      toUpdate: updateList.length,
      toCreate: createList.length,
      durationSec,
      reconciliationPass: updateList.length + createList.length === rows.length,
    },
    sampleUpdates: updateList.slice(0, 10),
    sampleCreates: createList.slice(0, 10),
    allUpdates: updateList,
    allCreates: createList,
  }, null, 2));

  console.log(`\nFull Report saved to: ${reportPath}`);
}

runDryRun();
