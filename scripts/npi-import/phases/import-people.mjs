// Phase 4: Import healthcare providers (doctors, clinicians) from CMS data
// into Twenty CRM as People with full field capture + rawSourceData.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, appendNdjson, appendNdjsonBatch, loadNdjsonSet, streamNdjson, ndjsonLineCount } from '../lib/state.mjs';
import { streamCsv } from '../lib/csv-reader.mjs';
import * as twenty from '../lib/twenty.mjs';
import { extractBatchItems } from '../lib/twenty.mjs';
import { transformDoctor, personDedupeKey } from '../lib/transforms.mjs';
import { DATA_FILES, TWENTY_BATCH_SIZE, TWENTY_RATE_INTERVAL_MS } from '../config.mjs';

const log = createLogger('people');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Step 1: Extract CMS doctors/clinicians into NDJSON
async function extract(options = {}) {
  const progress = loadProgress();
  if (progress.people.extractDone) {
    log.info(`Extraction already done (${progress.people.extractCount.toLocaleString()} records)`);
    return;
  }

  log.info('Extracting people from CMS doctors/clinicians CSV...');

  const limit = options.limit || Infinity;
  let count = 0;
  let batch = [];

  await streamCsv(DATA_FILES.cmsDoctors, async (record) => {
    batch.push(record);

    if (batch.length >= 1000) {
      appendNdjsonBatch('raw_people', batch);
      count += batch.length;
      batch = [];

      if (count % 100000 === 0) {
        progress.people.extractCount = count;
        saveProgress();
        log.progress(count, 3388628, 'extracted');
      }
    }
  }, { limit });

  // Flush remaining
  if (batch.length > 0) {
    appendNdjsonBatch('raw_people', batch);
    count += batch.length;
  }

  log.progressDone();

  progress.people.extractDone = true;
  progress.people.extractCount = count;
  saveProgress();

  log.ok(`Extracted ${count.toLocaleString()} people records`);
}

// Step 2: Load extracted people into Twenty
async function load(options = {}) {
  const progress = loadProgress();
  if (progress.people.loadDone) {
    log.info(`Load already done (${progress.people.createdCount.toLocaleString()} created)`);
    return;
  }

  const totalRecords = ndjsonLineCount('raw_people');
  log.info(`Loading people into Twenty (${totalRecords.toLocaleString()} records, resuming from offset ${progress.people.loadOffset})...`);

  // Load existing dedup keys
  const dedup = await loadNdjsonSet('person_map', (r) => r.dedupeKey);
  log.info(`Loaded ${dedup.size.toLocaleString()} existing dedup keys`);

  let batch = [];
  let batchMeta = [];

  await streamNdjson('raw_people', async (record, lineIdx) => {
    const key = personDedupeKey(record);

    if (dedup.has(key)) {
      progress.people.skippedDupes++;
      progress.people.loadOffset = lineIdx + 1;
      return;
    }

    dedup.add(key);
    const payload = transformDoctor(record);
    batch.push(payload);
    batchMeta.push({ npi: record['NPI'], dedupeKey: key });

    if (batch.length >= TWENTY_BATCH_SIZE) {
      try {
        const result = await twenty.createBatch('people', batch);
        const created = extractBatchItems(result);

        for (let i = 0; i < batchMeta.length; i++) {
          const twentyId = created[i]?.id || null;
          appendNdjson('person_map', {
            npi: batchMeta[i].npi,
            twentyId,
            dedupeKey: batchMeta[i].dedupeKey,
          });
        }

        progress.people.createdCount += created.length;
      } catch (err) {
        log.error(`Batch at offset ${lineIdx} failed: ${err.message.slice(0, 300)}`);
        progress.people.loadOffset = lineIdx - batch.length + 1;
        saveProgress();
        throw err;
      }

      progress.people.loadOffset = lineIdx + 1;
      saveProgress();
      log.progress(lineIdx + 1, totalRecords, `created: ${progress.people.createdCount.toLocaleString()}, dupes: ${progress.people.skippedDupes.toLocaleString()}`);

      batch = [];
      batchMeta = [];
      await sleep(TWENTY_RATE_INTERVAL_MS);
    }
  }, progress.people.loadOffset);

  // Flush remaining
  if (batch.length > 0) {
    try {
      const result = await twenty.createBatch('people', batch);
      const created = extractBatchItems(result);

      for (let i = 0; i < batchMeta.length; i++) {
        const twentyId = created[i]?.id || null;
        appendNdjson('person_map', {
          npi: batchMeta[i].npi,
          twentyId,
          dedupeKey: batchMeta[i].dedupeKey,
        });
      }
      progress.people.createdCount += created.length;
    } catch (err) {
      log.error(`Final batch failed: ${err.message.slice(0, 300)}`);
      saveProgress();
      throw err;
    }
  }

  log.progressDone();
  progress.people.loadDone = true;
  saveProgress();
  log.ok(`Loaded ${progress.people.createdCount.toLocaleString()} people (${progress.people.skippedDupes.toLocaleString()} dupes skipped)`);
}

export async function run(options = {}) {
  await extract(options);
  await load(options);
  const progress = loadProgress();
  progress.currentPhase = 'enrich';
  saveProgress();
}
