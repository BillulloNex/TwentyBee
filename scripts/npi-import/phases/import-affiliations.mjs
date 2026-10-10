// Phase 6: Create providerAffiliation records linking People to Healthcare Facilities.
// Uses CMS Doctors data (org_pac_id, Facility Name) and PECOS enrollment data.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, loadNdjsonMap, appendNdjson, streamNdjson, ndjsonLineCount } from '../lib/state.mjs';
import { streamCsv } from '../lib/csv-reader.mjs';
import * as twenty from '../lib/twenty.mjs';
import { extractBatchItems } from '../lib/twenty.mjs';
import { DATA_FILES, TWENTY_BATCH_SIZE, TWENTY_RATE_INTERVAL_MS } from '../config.mjs';

const log = createLogger('affiliations');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function run() {
  const progress = loadProgress();

  if (progress.affiliations.done) {
    log.info('Affiliations already done, skipping');
    return;
  }

  // Load maps
  log.info('Loading person and facility maps...');
  const personMap = await loadNdjsonMap('person_map', (r) => r.npi);
  log.info(`  ${personMap.size.toLocaleString()} people loaded`);

  // Build facility lookup by facilityId
  const facilityMap = await loadNdjsonMap('facility_map', (r) => r.facilityId);
  log.info(`  ${facilityMap.size.toLocaleString()} facilities loaded`);

  if (personMap.size === 0 || facilityMap.size === 0) {
    log.warn('Missing person or facility maps — skipping affiliations. Run people and facilities first.');
    return;
  }

  log.info('Creating provider affiliations from CMS doctor data...');

  // Read raw_people NDJSON and extract affiliation info
  const totalRecords = ndjsonLineCount('raw_people');
  let batch = [];
  let created = 0;
  let skipped = 0;
  let processed = 0;
  const seen = new Set();

  await streamNdjson('raw_people', async (record, lineIdx) => {
    processed++;

    const npi = record['NPI'];
    const facilityName = record['Facility Name'] || '';
    const orgPacId = record['org_pac_id'] || '';

    if (!npi || !facilityName) {
      skipped++;
      return;
    }

    // Create a dedup key for the affiliation
    const affKey = `${npi}|${facilityName}`;
    if (seen.has(affKey)) {
      skipped++;
      return;
    }
    seen.add(affKey);

    // Try to find the person's Twenty ID
    const person = personMap.get(npi);
    if (!person?.twentyId) {
      skipped++;
      return;
    }

    const payload = {
      npi,
      facilityId: orgPacId,
      facilityName: facilityName,
      providerType: record['Provider Type'] || '',
      specialty: record['pri_spec'] || '',
      dataSource: 'NPI/NPPES — CMS Doctors',
    };

    batch.push(payload);

    if (batch.length >= TWENTY_BATCH_SIZE) {
      try {
        const result = await twenty.createBatch('providerAffiliations', batch);
        const items = extractBatchItems(result);
        created += items.length;
      } catch (err) {
        log.error(`Batch at line ${lineIdx} failed: ${err.message.slice(0, 300)}`);
        progress.affiliations.created = created;
        progress.affiliations.processed = processed;
        saveProgress();
        throw err;
      }

      if (processed % 50000 === 0) {
        progress.affiliations.created = created;
        progress.affiliations.processed = processed;
        saveProgress();
        log.progress(processed, totalRecords, `created: ${created.toLocaleString()}, skipped: ${skipped.toLocaleString()}`);
      }

      batch = [];
      await sleep(TWENTY_RATE_INTERVAL_MS);
    }
  }, progress.affiliations.offset || 0);

  // Flush remaining
  if (batch.length > 0) {
    try {
      const result = await twenty.createBatch('providerAffiliations', batch);
      const items = extractBatchItems(result);
      created += items.length;
    } catch (err) {
      log.error(`Final batch failed: ${err.message.slice(0, 300)}`);
      progress.affiliations.created = created;
      progress.affiliations.processed = processed;
      saveProgress();
      throw err;
    }
  }

  log.progressDone();
  progress.affiliations.done = true;
  progress.affiliations.created = created;
  progress.affiliations.processed = processed;
  saveProgress();

  log.ok(`Affiliations complete — ${created.toLocaleString()} created, ${skipped.toLocaleString()} skipped`);
}
