import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envContent = readFileSync(resolve(__dirname, '.env'), 'utf8');
let apiKey = '';
let baseUrl = 'https://20.beenex.cloud';
for (const line of envContent.split('\n')) {
  if (line.startsWith('TWENTY_API_KEY=')) apiKey = line.slice('TWENTY_API_KEY='.length).trim();
  if (line.startsWith('TWENTY_BASE_URL=')) baseUrl = line.slice('TWENTY_BASE_URL='.length).trim();
}

// Load dry run report
const reportPath = resolve(__dirname, 'dry_run_companies_report.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const { allUpdates, allCreates } = report;

console.log(`================ STARTING COMPANY LIVE ENRICHMENT ================`);
console.log(`Existing Companies to Enrich/Patch: ${allUpdates.length}`);
console.log(`New Companies to Insert:            ${allCreates.length}`);
console.log(`Total Companies:                    ${allUpdates.length + allCreates.length}`);
console.log(`==================================================================\n`);

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// Helper: safe fetch with 429 backoff
async function fetchWithRetry(url, options, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const errJson = await res.json().catch(() => ({}));
      const waitSec = errJson.retryAfterSeconds || 2;
      console.log(`    [Rate Limit 429] Waiting ${waitSec + 1}s before retry (attempt ${attempt}/${maxRetries})...`);
      await sleep((waitSec + 1) * 1000);
      continue;
    }
    return res;
  }
  return fetch(url, options);
}

// ========================================================
// PHASE 1: CREATE NEW COMPANIES (6)
// ========================================================
const createLedger = [];

async function createNewCompanies() {
  if (allCreates.length === 0) return;
  console.log(`[Phase 1] Creating ${allCreates.length} brand-new companies...`);

  const payloads = allCreates.map(c => ({
    name: c.row.name,
    domainName: c.row.domain ? {
      primaryLinkLabel: c.row.domain,
      primaryLinkUrl: c.row.domain,
    } : undefined,
    companyType: 'Medical Practice',
    phoneNumber: c.row.phoneNumber || undefined,
    linkedinLink: c.row.linkedin ? {
      primaryLinkLabel: 'LinkedIn',
      primaryLinkUrl: c.row.linkedin,
    } : undefined,
    address: c.row.address.addressStreet1 ? c.row.address : undefined,
    orgPacId: c.row.orgPacId || undefined,
    clinicianCount: c.row.clinicianCount || undefined,
    fitScore: c.row.fitScore || undefined,
    painPoints: c.row.painPoints || undefined,
    enrichmentSources: c.row.enrichmentSources || undefined,
    enrichmentStatus: c.row.enrichmentStatus || undefined,
    dataSource: 'Company Enrichment / Pilot Research',
    dataSourceDate: '2026-10-11',
  }));

  const res = await fetchWithRetry(`${baseUrl}/rest/batch/companies`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payloads),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Batch company creation failed: ${errText}`);
  }

  const data = await res.json();
  const createdItems = data?.data?.createCompanies || [];
  createdItems.forEach(item => {
    createLedger.push({ id: item.id, name: item.name });
  });

  console.log(`[Phase 1 Completed] Created ${createLedger.length} new companies.\n`);
}

// ========================================================
// PHASE 2: ENRICH EXISTING COMPANIES (260)
// ========================================================
const updateLedger = [];

async function enrichExistingCompanies() {
  console.log(`[Phase 2] Enriching ${allUpdates.length} existing companies with rate-limit pacing (650ms)...`);

  let updatedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < allUpdates.length; i++) {
    const item = allUpdates[i];
    const companyId = item.twentyId;
    const row = item.row;

    const payload = {
      companyType: 'Medical Practice',
      phoneNumber: row.phoneNumber || undefined,
      orgPacId: row.orgPacId || undefined,
      clinicianCount: row.clinicianCount || undefined,
      fitScore: row.fitScore || undefined,
      painPoints: row.painPoints || undefined,
      enrichmentSources: row.enrichmentSources || undefined,
      enrichmentStatus: row.enrichmentStatus || undefined,
    };

    if (row.address.addressStreet1) {
      payload.address = row.address;
    }

    if (row.linkedin) {
      payload.linkedinLink = {
        primaryLinkLabel: 'LinkedIn',
        primaryLinkUrl: row.linkedin,
      };
    }

    try {
      const res = await fetchWithRetry(`${baseUrl}/rest/companies/${companyId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`  [FAILED PATCH] ${row.name} (${companyId}): ${res.status} - ${errText.slice(0, 100)}`);
        failedCount++;
        updateLedger.push({ companyId, name: row.name, status: 'FAILED', error: errText });
      } else {
        updatedCount++;
        updateLedger.push({ companyId, name: row.name, status: 'ENRICHED', fitScore: row.fitScore });
      }
    } catch (err) {
      failedCount++;
      updateLedger.push({ companyId, name: row.name, status: 'ERROR', error: err.message });
    }

    if ((i + 1) % 25 === 0 || i === allUpdates.length - 1) {
      console.log(`  Progress: ${i + 1}/${allUpdates.length} companies processed (Enriched: ${updatedCount}, Failed: ${failedCount})`);
    }

    await sleep(650);
  }

  console.log(`\n[Phase 2 Completed] Enriched: ${updatedCount}, Failed: ${failedCount}\n`);
}

async function run() {
  const t0 = Date.now();

  await createNewCompanies();
  await enrichExistingCompanies();

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);

  // Write execution ledger
  const ledgerPath = resolve(__dirname, 'execution_companies_ledger.json');
  writeFileSync(ledgerPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    durationSec,
    summary: {
      totalInputCompanies: report.summary.totalInputCompanies,
      companiesEnriched: updateLedger.filter(u => u.status === 'ENRICHED').length,
      companiesCreated: createLedger.length,
      totalReconciled: updateLedger.filter(u => u.status === 'ENRICHED').length + createLedger.length,
    },
    createLedger,
    updateLedger,
  }, null, 2));

  console.log(`================ FINAL COMPANY AUDIT ================`);
  console.log(`Duration:                     ${durationSec}s`);
  console.log(`Companies Enriched (Patched): ${updateLedger.filter(u => u.status === 'ENRICHED').length} / ${allUpdates.length}`);
  console.log(`Companies Created Fresh:      ${createLedger.length} / ${allCreates.length}`);
  console.log(`Reconciliation Total:         ${updateLedger.filter(u => u.status === 'ENRICHED').length + createLedger.length} / ${report.summary.totalInputCompanies}`);
  console.log(`Audit Ledger:                 ${ledgerPath}`);
  console.log(`=====================================================\n`);
}

run().catch(err => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
