// Phase 5: Enrich People with NPPES data — address, taxonomy codes, license info.
// Uses GraphQL mutations (no rate limit!) with 10 concurrent requests.
// Streams the 11 GB extracted NPPES CSV, cross-references by NPI.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, loadNdjsonMap } from '../lib/state.mjs';
import { streamCsv } from '../lib/csv-reader.mjs';
import { resolve, dirname } from 'node:path';
import { DATA_FILES, TWENTY_BASE_URL, TWENTY_API_KEY } from '../config.mjs';

const log = createLogger('enrich');

const CONCURRENCY = 10;  // Concurrent GraphQL mutations
const GRAPHQL_URL = `${TWENTY_BASE_URL}/graphql`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function titleCase(str) {
  if (!str) return '';
  return str.toLowerCase().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatPhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

function formatZip(raw) {
  if (!raw) return '';
  const zip = raw.replace(/\D/g, '');
  if (zip.length >= 5) return zip.slice(0, 5);
  return zip.padStart(5, '0');
}

// ---------- GraphQL mutation engine ----------

async function graphqlUpdatePerson(twentyId, updates) {
  // Build GraphQL data input fields
  const fields = Object.entries(updates)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');

  const query = `mutation { updatePerson(id: "${twentyId}", data: { ${fields} }) { id } }`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TWENTY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (res.status === 429) {
        const waitMs = 5000 * attempt;
        if (attempt < 5) { await sleep(waitMs); continue; }
        throw new Error(`Rate limited after ${attempt} retries`);
      }

      if (res.status >= 500 && attempt < 5) {
        await sleep(3000 * attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`${res.status}: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(json.errors[0].message.slice(0, 200));
      }
      return true;
    } catch (err) {
      if (attempt < 5 && (err.cause?.code === 'ECONNRESET' || err.message?.includes('fetch failed'))) {
        await sleep(3000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

// Process a batch of items concurrently
async function processBatch(batch, stats) {
  const promises = batch.map(async (item) => {
    try {
      await graphqlUpdatePerson(item.twentyId, item.updates);
      stats.enriched++;
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 10 || stats.errors % 1000 === 0) {
        log.warn(`  Patch failed NPI ${item.npi}: ${err.message.slice(0, 150)}`);
      }
    }
  });
  await Promise.all(promises);
}

// ---------- Build updates ----------

function buildUpdates(record) {
  const updates = {};

  const practiceAddress = record['Provider First Line Business Practice Location Address'];
  const practiceCity = record['Provider Business Practice Location Address City Name'];
  const practiceState = record['Provider Business Practice Location Address State Name'];
  const practiceZip = record['Provider Business Practice Location Address Postal Code'];
  const practicePhone = record['Provider Business Practice Location Address Telephone Number'];

  if (practiceAddress && practiceCity) {
    updates.addressStreet = titleCase(practiceAddress);
    const addr2 = record['Provider Second Line Business Practice Location Address'];
    if (addr2) updates.addressStreet2 = titleCase(addr2);
    updates.addressCity = titleCase(practiceCity);
    updates.addressState = (practiceState || '').toUpperCase();
    updates.addressZip = formatZip(practiceZip);
  }
  if (practicePhone) {
    updates.phoneNumber = formatPhone(practicePhone);
  }

  const taxonomy1 = record['Healthcare Provider Taxonomy Code_1'];
  if (taxonomy1) {
    updates.taxonomyCode = taxonomy1;
    const taxDesc = record['Healthcare Provider Primary Taxonomy Switch_1'];
    if (taxDesc === 'Y') {
      updates.taxonomyDescription = `Primary: ${taxonomy1}`;
    }
  }

  const licNum = record['Provider License Number_1'];
  const licState = record['Provider License Number State Code_1'];
  if (licNum) {
    updates.licenseNumber = licNum;
    updates.licenseState = (licState || '').toUpperCase();
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

// ---------- Main ----------

export async function run() {
  const progress = loadProgress();

  if (progress.enrich.done) {
    log.info('Enrichment already done, skipping');
    return;
  }

  log.info('Loading person NPI→Twenty ID mapping...');
  const personMap = await loadNdjsonMap('person_map', (r) => r.npi);
  log.info(`Loaded ${personMap.size.toLocaleString()} person NPI mappings`);

  if (personMap.size === 0) {
    log.warn('No person mappings found — skipping enrichment.');
    return;
  }

  const nppesExtractedPath = resolve(dirname(DATA_FILES.nppesZip), DATA_FILES.nppesMainFile);
  log.info('Streaming extracted NPPES CSV for enrichment...');
  log.info(`  CSV: ${nppesExtractedPath}`);
  log.info(`  Mode: GraphQL mutations, ${CONCURRENCY} concurrent`);

  const stats = { enriched: 0, errors: 0 };
  let matched = 0;
  let processed = 0;
  let pendingBatch = [];
  const startTime = Date.now();

  try {
    await streamCsv(
      nppesExtractedPath,
      async (record) => {
        processed++;

        if (processed === 1) {
          log.info(`  First record: NPI=${record['NPI']}, Entity=${record['Entity Type Code']}`);
        }

        if (processed % 10000 === 0) {
          progress.enrich.nppesProcessed = processed;
          progress.enrich.enrichedPeople = stats.enriched;
          saveProgress();
          const elapsedMin = (Date.now() - startTime) / 60000;
          const rate = elapsedMin > 0.1 ? Math.round(stats.enriched / elapsedMin) : 0;
          log.progress(processed, 8000000, `enriched: ${stats.enriched.toLocaleString()}, errors: ${stats.errors}, ${rate}/min`);
        }

        if (record['Entity Type Code'] !== '1') return;

        const npi = record['NPI'];
        const person = personMap.get(npi);
        if (!person?.twentyId) return;

        const updates = buildUpdates(record);
        if (!updates) return;

        matched++;
        if (matched === 1) {
          log.info(`  First match: NPI=${npi}, twentyId=${person.twentyId}`);
        }

        pendingBatch.push({ twentyId: person.twentyId, updates, npi });

        if (pendingBatch.length >= CONCURRENCY) {
          await processBatch(pendingBatch, stats);
          pendingBatch = [];
        }
      },
      { startOffset: progress.enrich.nppesProcessed || 0 }
    );

    // Flush remaining
    if (pendingBatch.length > 0) {
      await processBatch(pendingBatch, stats);
    }
  } catch (err) {
    log.error(`NPPES stream error: ${err.message}`);
    progress.enrich.nppesProcessed = processed;
    progress.enrich.enrichedPeople = stats.enriched;
    saveProgress();
    throw err;
  }

  log.progressDone();
  progress.enrich.done = true;
  progress.enrich.nppesProcessed = processed;
  progress.enrich.enrichedPeople = stats.enriched;
  progress.currentPhase = 'affiliations';
  saveProgress();

  log.ok(`Enrichment complete — ${matched.toLocaleString()} matched, ${stats.enriched.toLocaleString()} enriched, ${stats.errors.toLocaleString()} errors out of ${processed.toLocaleString()} NPPES records`);
}
