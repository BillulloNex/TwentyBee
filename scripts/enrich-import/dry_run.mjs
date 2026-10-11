import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from './lib/parser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envContent = readFileSync(resolve(__dirname, '.env'), 'utf8');
let apiKey = '';
let baseUrl = 'https://20.beenex.cloud';
for (const line of envContent.split('\n')) {
  if (line.startsWith('TWENTY_API_KEY=')) apiKey = line.slice('TWENTY_API_KEY='.length).trim();
  if (line.startsWith('TWENTY_BASE_URL=')) baseUrl = line.slice('TWENTY_BASE_URL='.length).trim();
}

const csvPath = resolve(__dirname, 'data/contacts_raw.csv');
const rows = parseCSV(csvPath);

console.log(`Parsed ${rows.length} contacts from CSV.`);

// Concurrency pool helper
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  
  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err.message, item: items[i] };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// 1. Extract Unique Companies
const companiesMap = new Map();
for (const row of rows) {
  const key = row.company.toLowerCase().trim();
  if (!companiesMap.has(key)) {
    companiesMap.set(key, {
      name: row.company,
      domain: row.domain,
      contactsCount: 0,
      decisionMakersCount: 0,
    });
  }
  const comp = companiesMap.get(key);
  comp.contactsCount++;
  if (row.decisionMaker) comp.decisionMakersCount++;
}

console.log(`Extracted ${companiesMap.size} unique medical practice companies.`);

// 2. Query Candidate Clinicians from Twenty
async function checkContactInTwenty(row) {
  const firstName = row.firstName.split(/[\s-]/)[0].replace(/[^a-zA-Z]/g, '');
  const lastName = row.lastName.replace(/[^a-zA-Z]/g, '');

  if (!lastName || lastName.length < 2) {
    return {
      row,
      action: 'CREATE_NEW',
      reason: 'No standard last name to match',
      match: null,
    };
  }

  // If role is clearly non-clinical admin (e.g. Coordinator, Office Manager, Practice Manager, Billing) and NO NPI
  const isObviousAdmin = /manager|administrator|director|coordinator|liaison|accounting/i.test(row.jobTitle) &&
                         !/md|do|physician|surgeon|owner|founder|president|partner/i.test(row.jobTitle) &&
                         !row.extractedNpi;

  // We can still query Twenty to be 100% sure, but if not found or if obvious admin without match, it's CREATE_NEW
  const query = `query {
    people(filter: {
      and: [
        { name: { lastName: { ilike: "%${lastName}%" } } },
        { name: { firstName: { ilike: "%${firstName}%" } } }
      ]
    }, first: 5) {
      edges {
        node {
          id
          name { firstName lastName }
          npi
          credential
          primarySpecialty
          facilityName
          addressState
          addressCity
          jobTitle
          emails { primaryEmail }
          linkedinLink { primaryLinkUrl }
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
    const edges = data?.data?.people?.edges || [];

    if (edges.length === 0) {
      return {
        row,
        action: 'CREATE_NEW',
        reason: 'No existing clinical record in Twenty',
        match: null,
      };
    }

    // Evaluate candidates with multi-factor verification
    let bestMatch = null;
    let confidence = 'NONE';

    for (const edge of edges) {
      const node = edge.node;
      
      // 1. Direct NPI match
      if (row.extractedNpi && node.npi === row.extractedNpi) {
        bestMatch = node;
        confidence = 'HIGH_NPI_MATCH';
        break;
      }

      // 2. Facility Name match
      const nodeFac = (node.facilityName || '').toLowerCase();
      const compLower = row.company.toLowerCase();
      const compWords = compLower.split(/[\s,.-]+/).filter(w => w.length > 3 && !['associates', 'medical', 'group', 'clinic', 'health', 'center', 'care', 'llc', 'inc', 'pllc'].includes(w));
      const hasWordMatch = compWords.some(w => nodeFac.includes(w));

      if (hasWordMatch) {
        bestMatch = node;
        confidence = 'HIGH_FACILITY_MATCH';
        break;
      }

      // 3. State match
      if (row.stateHint && node.addressState && (row.stateHint === node.addressState.toUpperCase())) {
        if (!bestMatch) {
          bestMatch = node;
          confidence = 'MEDIUM_STATE_MATCH';
        }
      }
    }

    // If exactly 1 result returned by Twenty and the name is rare/exact
    if (!bestMatch && edges.length === 1 && !isObviousAdmin) {
      bestMatch = edges[0].node;
      confidence = 'MEDIUM_EXACT_NAME_ONLY';
    }

    if (bestMatch && confidence !== 'NONE') {
      return {
        row,
        action: 'UPDATE_EXISTING',
        confidence,
        twentyId: bestMatch.id,
        currentRecord: {
          id: bestMatch.id,
          name: `${bestMatch.name.firstName} ${bestMatch.name.lastName}`,
          npi: bestMatch.npi,
          credential: bestMatch.credential,
          specialty: bestMatch.primarySpecialty,
          facilityName: bestMatch.facilityName,
          location: `${bestMatch.addressCity || ''}, ${bestMatch.addressState || ''}`,
          currentJobTitle: bestMatch.jobTitle || '(blank)',
          currentEmail: bestMatch.emails?.primaryEmail || '(blank)',
          currentLinkedIn: bestMatch.linkedinLink?.primaryLinkUrl || '(blank)',
        },
        proposedUpdates: {
          jobTitle: row.jobTitle,
          company: row.company,
          email: row.email || '(none)',
          linkedin: row.linkedin || '(none)',
          decisionMaker: row.decisionMaker,
          emailStatus: row.emailStatus,
          emailSource: row.emailSource.slice(0, 100),
        },
      };
    }

    return {
      row,
      action: 'CREATE_NEW',
      reason: edges.length > 1 ? `Ambiguous: ${edges.length} doctors found with same name but no practice/state match (protecting existing records)` : 'No confidence match',
      matchCount: edges.length,
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
  console.log(`Starting parallel dry-run match for all ${rows.length} contacts (concurrency: 6)...`);
  const t0 = Date.now();
  
  let processed = 0;
  const results = await mapConcurrent(rows, 6, async (row) => {
    const res = await checkContactInTwenty(row);
    processed++;
    if (processed % 50 === 0 || processed === rows.length) {
      console.log(`  Processed ${processed}/${rows.length} contacts...`);
    }
    return res;
  });

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Finished dry-run evaluation in ${durationSec}s.`);

  // Audit Calculations
  const updateList = results.filter(r => r.action === 'UPDATE_EXISTING');
  const createList = results.filter(r => r.action === 'CREATE_NEW');

  console.log(`\n=================== DRY RUN AUDIT REPORT ===================`);
  console.log(`Total Input Contacts:                ${rows.length}`);
  console.log(`Unique Medical Practices (Company):  ${companiesMap.size}`);
  console.log(`────────────────────────────────────────────────────────────`);
  console.log(`Contacts to UPDATE in Twenty:        ${updateList.length} (${((updateList.length/rows.length)*100).toFixed(1)}%)`);
  console.log(`Contacts to CREATE in Twenty:        ${createList.length} (${((createList.length/rows.length)*100).toFixed(1)}%)`);
  console.log(`Reconciliation Check:                ${updateList.length} + ${createList.length} = ${updateList.length + createList.length} (Matches 352: ${updateList.length + createList.length === rows.length})`);
  console.log(`============================================================`);

  // Breakdown by confidence
  const highNpi = updateList.filter(u => u.confidence === 'HIGH_NPI_MATCH').length;
  const highFac = updateList.filter(u => u.confidence === 'HIGH_FACILITY_MATCH').length;
  const medState = updateList.filter(u => u.confidence === 'MEDIUM_STATE_MATCH').length;
  const medExact = updateList.filter(u => u.confidence === 'MEDIUM_EXACT_NAME_ONLY').length;

  console.log(`\nMatching Confidence Breakdown:`);
  console.log(`  • High Confidence (NPI Match):       ${highNpi}`);
  console.log(`  • High Confidence (Facility Match):  ${highFac}`);
  console.log(`  • Medium Confidence (State Match):   ${medState}`);
  console.log(`  • Exact Unique Name Match:          ${medExact}`);

  // Create list breakdown
  const adminNew = createList.filter(c => /admin|manager|director|coordinator|coo|cfo|operations/i.test(c.row.jobTitle)).length;
  const docNew = createList.length - adminNew;
  console.log(`\nNew Contacts Breakdown:`);
  console.log(`  • Practice Admins / Managers:       ${adminNew}`);
  console.log(`  • Clinicians / Owners (New):        ${docNew}`);

  // Write full JSON report
  const reportPath = resolve(__dirname, 'dry_run_report.json');
  writeFileSync(reportPath, JSON.stringify({
    summary: {
      totalContacts: rows.length,
      totalCompanies: companiesMap.size,
      toUpdate: updateList.length,
      toCreate: createList.length,
      durationSec,
      reconciliationPass: updateList.length + createList.length === rows.length,
    },
    companies: Array.from(companiesMap.values()),
    sampleUpdates: updateList.slice(0, 10),
    sampleCreates: createList.slice(0, 10),
    allUpdates: updateList,
    allCreates: createList,
  }, null, 2));

  console.log(`\nFull Dry-Run Report written to: ${reportPath}`);
}

runDryRun();
