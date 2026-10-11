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

// Load pre-verified dry run report
const reportPath = resolve(__dirname, 'dry_run_report.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const { companies, allUpdates, allCreates } = report;

console.log(`================ STARTING LIVE IMPORT ================`);
console.log(`Medical Practices to Create: ${companies.length}`);
console.log(`Existing Clinicians to Patch: ${allUpdates.length}`);
console.log(`New Contacts to Insert:       ${allCreates.length}`);
console.log(`Total Contacts Accounted:     ${allUpdates.length + allCreates.length}`);
console.log(`======================================================\n`);

async function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// Concurrency helper
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

// ========================================================
// PHASE 1: CREATE MEDICAL PRACTICE COMPANIES
// ========================================================
const companyLookup = new Map(); // lowercase name -> company UUID

async function createCompanies() {
  console.log(`[Phase 1] Creating ${companies.length} Medical Practice companies...`);
  
  const batchSize = 100;
  let createdCount = 0;

  for (let i = 0; i < companies.length; i += batchSize) {
    const chunk = companies.slice(i, i + batchSize);
    const payloads = chunk.map(c => ({
      name: c.name,
      domainName: c.domain ? {
        primaryLinkLabel: c.domain,
        primaryLinkUrl: c.domain,
      } : undefined,
      companyType: 'Medical Practice',
      dataSource: 'Enrichment / Intern Research',
      dataSourceDate: '2026-10-11',
    }));

    const res = await fetch(`${baseUrl}/rest/batch/companies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloads),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Batch company creation failed (status ${res.status}): ${errText}`);
    }

    const data = await res.json();
    const createdItems = data?.data?.createCompanies || [];
    createdCount += createdItems.length;

    // Map each returned company to lookup map
    createdItems.forEach(item => {
      companyLookup.set(item.name.toLowerCase().trim(), item.id);
    });

    console.log(`  Batch ${Math.floor(i / batchSize) + 1}: Created ${createdItems.length} companies (Total so far: ${createdCount}/${companies.length})`);
    await sleep(200);
  }

  console.log(`[Phase 1 Completed] ${createdCount} companies created in Twenty.\n`);
}

// ========================================================
// PHASE 2: UPDATE EXISTING CLINICIANS
// ========================================================
const updateLedger = [];

async function updateClinicians() {
  console.log(`[Phase 2] Updating ${allUpdates.length} verified existing clinician records...`);

  let updatedCount = 0;
  let failedCount = 0;

  await mapConcurrent(allUpdates, 8, async (item, idx) => {
    const personId = item.twentyId;
    const compKey = item.row.company.toLowerCase().trim();
    const companyId = companyLookup.get(compKey);

    const payload = {
      jobTitle: item.row.jobTitle || undefined,
      decisionMaker: item.row.decisionMaker,
      emailStatus: item.row.emailStatus,
      emailSource: item.row.emailSource,
    };

    if (companyId) {
      payload.companyId = companyId;
    }

    if (item.row.email) {
      payload.emails = { primaryEmail: item.row.email };
    }

    if (item.row.linkedin) {
      payload.linkedinLink = {
        primaryLinkLabel: 'LinkedIn',
        primaryLinkUrl: item.row.linkedin,
      };
    }

    try {
      const res = await fetch(`${baseUrl}/rest/people/${personId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`  [FAILED PATCH] ${item.row.fullName} (${personId}): ${res.status} - ${errText}`);
        failedCount++;
        updateLedger.push({ personId, name: item.row.fullName, status: 'FAILED', error: errText });
      } else {
        updatedCount++;
        updateLedger.push({ personId, name: item.row.fullName, status: 'UPDATED', companyId });
      }
    } catch (err) {
      failedCount++;
      updateLedger.push({ personId, name: item.row.fullName, status: 'ERROR', error: err.message });
    }

    if ((idx + 1) % 25 === 0 || idx === allUpdates.length - 1) {
      console.log(`  Processed ${idx + 1}/${allUpdates.length} updates...`);
    }
  });

  console.log(`[Phase 2 Completed] Successfully updated: ${updatedCount}, Failed: ${failedCount}\n`);
}

// ========================================================
// PHASE 3: INSERT NEW ADMINISTRATORS & STAFF
// ========================================================
const createLedger = [];

async function createNewContacts() {
  console.log(`[Phase 3] Inserting ${allCreates.length} new practice administrators & contacts...`);

  const batchSize = 100;
  let createdCount = 0;

  for (let i = 0; i < allCreates.length; i += batchSize) {
    const chunk = allCreates.slice(i, i + batchSize);
    const payloads = chunk.map(c => {
      const compKey = c.row.company.toLowerCase().trim();
      const companyId = companyLookup.get(compKey);

      const payload = {
        name: {
          firstName: c.row.firstName,
          lastName: c.row.lastName,
        },
        jobTitle: c.row.jobTitle || undefined,
        decisionMaker: c.row.decisionMaker,
        emailStatus: c.row.emailStatus,
        emailSource: c.row.emailSource,
        dataSource: 'Enrichment / Intern Research',
        dataSourceDate: '2026-10-11',
      };

      if (companyId) {
        payload.companyId = companyId;
      }

      if (c.row.email) {
        payload.emails = { primaryEmail: c.row.email };
      }

      if (c.row.linkedin) {
        payload.linkedinLink = {
          primaryLinkLabel: 'LinkedIn',
          primaryLinkUrl: c.row.linkedin,
        };
      }

      return payload;
    });

    const res = await fetch(`${baseUrl}/rest/batch/people`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloads),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Batch people creation failed (status ${res.status}): ${errText}`);
    }

    const data = await res.json();
    const createdItems = data?.data?.createPeople || [];
    createdCount += createdItems.length;

    createdItems.forEach((item, idx) => {
      createLedger.push({
        id: item.id,
        name: `${item.name?.firstName || ''} ${item.name?.lastName || ''}`.trim(),
        companyId: item.companyId,
        jobTitle: item.jobTitle,
      });
    });

    console.log(`  Batch ${Math.floor(i / batchSize) + 1}: Inserted ${createdItems.length} people (Total so far: ${createdCount}/${allCreates.length})`);
    await sleep(200);
  }

  console.log(`[Phase 3 Completed] ${createdCount} new people created in Twenty.\n`);
}

// ========================================================
// PHASE 4: VERIFICATION & AUDIT LEDGER
// ========================================================
async function run() {
  const t0 = Date.now();

  await createCompanies();
  await updateClinicians();
  await createNewContacts();

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);

  // Write audit ledger
  const ledgerPath = resolve(__dirname, 'execution_ledger.json');
  writeFileSync(ledgerPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    durationSec,
    summary: {
      totalInputContacts: report.summary.totalContacts,
      companiesCreated: companyLookup.size,
      peopleUpdated: updateLedger.filter(u => u.status === 'UPDATED').length,
      peopleCreated: createLedger.length,
      totalContactsAccounted: updateLedger.filter(u => u.status === 'UPDATED').length + createLedger.length,
    },
    companiesMap: Object.fromEntries(companyLookup),
    updateLedger,
    createLedger,
  }, null, 2));

  console.log(`\n================ FINAL AUDIT LEDGER ================`);
  console.log(`Execution Duration:              ${durationSec}s`);
  console.log(`Companies Created:               ${companyLookup.size}`);
  console.log(`Existing Clinicians Updated:     ${updateLedger.filter(u => u.status === 'UPDATED').length}`);
  console.log(`New People Inserted:             ${createLedger.length}`);
  console.log(`Reconciliation Check:            ${updateLedger.filter(u => u.status === 'UPDATED').length + createLedger.length} / ${report.summary.totalContacts}`);
  console.log(`Audit Ledger File:               ${ledgerPath}`);
  console.log(`====================================================\n`);
}

run().catch(err => {
  console.error('\n[FATAL ERROR IN IMPORT]:', err);
  process.exit(1);
});
