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

// Load ledger & dry run report
const ledgerPath = resolve(__dirname, 'execution_ledger.json');
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));

const reportPath = resolve(__dirname, 'dry_run_report.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const failedIds = new Set(ledger.updateLedger.filter(u => u.status === 'FAILED').map(u => u.personId));
const itemsToRetry = report.allUpdates.filter(u => failedIds.has(u.twentyId));

console.log(`Retrying ${itemsToRetry.length} failed updates with safe rate limiting (700ms per request)...`);

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function runRetry() {
  console.log('Cooling down for 3 seconds to clear rate limit window...');
  await sleep(3000);

  let successCount = 0;
  let stillFailed = 0;

  for (let i = 0; i < itemsToRetry.length; i++) {
    const item = itemsToRetry[i];
    const personId = item.twentyId;
    const compKey = item.row.company.toLowerCase().trim();
    const companyId = ledger.companiesMap[compKey];

    const payload = {
      jobTitle: item.row.jobTitle || undefined,
      decisionMaker: item.row.decisionMaker,
      emailStatus: item.row.emailStatus,
      emailSource: item.row.emailSource,
    };

    if (companyId) payload.companyId = companyId;
    if (item.row.email) payload.emails = { primaryEmail: item.row.email };
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
        console.error(`  [STILL FAILED] ${item.row.fullName}: ${res.status} - ${errText.slice(0, 100)}`);
        stillFailed++;
      } else {
        successCount++;
        // Update item in ledger
        const ledgerItem = ledger.updateLedger.find(u => u.personId === personId);
        if (ledgerItem) {
          ledgerItem.status = 'UPDATED';
          ledgerItem.companyId = companyId;
          delete ledgerItem.error;
        }
      }
    } catch (err) {
      console.error(`  [ERROR] ${item.row.fullName}: ${err.message}`);
      stillFailed++;
    }

    if ((i + 1) % 10 === 0 || i === itemsToRetry.length - 1) {
      console.log(`  Processed ${i + 1}/${itemsToRetry.length} (Success: ${successCount}, Failed: ${stillFailed})`);
    }

    await sleep(700);
  }

  // Update summary in ledger
  ledger.summary.peopleUpdated = ledger.updateLedger.filter(u => u.status === 'UPDATED').length;
  ledger.summary.totalContactsAccounted = ledger.summary.peopleUpdated + ledger.createLedger.length;
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  console.log(`\n================ RETRY COMPLETE ================`);
  console.log(`Retried:                 ${itemsToRetry.length}`);
  console.log(`Now Successfully Updated:${successCount}`);
  console.log(`Still Failed:            ${stillFailed}`);
  console.log(`Total Updated People:    ${ledger.summary.peopleUpdated} / 107`);
  console.log(`Total Created People:    ${ledger.createLedger.length} / 245`);
  console.log(`Reconciliation Check:    ${ledger.summary.totalContactsAccounted} / ${ledger.summary.totalInputContacts} (${ledger.summary.totalContactsAccounted === ledger.summary.totalInputContacts ? 'PERFECT 100% RECONCILED' : 'PARTIAL'})`);
  console.log(`================================================\n`);
}

runRetry().catch(err => {
  console.error('Retry script fatal error:', err);
});
