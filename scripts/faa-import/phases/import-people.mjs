// Phase 3: Extract individuals from Notion → dedupe → load into Twenty as People.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, appendNdjsonBatch, appendNdjson, ndjsonLineCount, streamNdjson, loadNdjsonSet } from '../lib/state.mjs';
import { extractDatabasePartitioned } from '../lib/notion.mjs';
import * as twenty from '../lib/twenty.mjs';
import { transformPerson, personDedupeKey } from '../lib/transforms.mjs';
import { NOTION_DB, TWENTY_BATCH_SIZE, TWENTY_RATE_INTERVAL_MS } from '../config.mjs';

const log = createLogger('people');

async function extract() {
  const progress = loadProgress();
  if (progress.people.extractDone) {
    log.info(`Extraction already done (${progress.people.extractCount.toLocaleString()} records)`);
    return;
  }

  log.info('Extracting individuals from Notion (partitioned by first letter)...');

  await extractDatabasePartitioned(NOTION_DB.individuals, 'Name', {
    log,
    onPage: async (records, cursor) => {
      appendNdjsonBatch('raw_people', records);
      progress.people.extractCount += records.length;
      saveProgress();
      log.progress(progress.people.extractCount, 128649, 'extracted');
    },
  });

  log.progressDone();
  progress.people.extractDone = true;
  progress.people.extractCount = ndjsonLineCount('raw_people');
  saveProgress();
  log.ok(`Extracted ${progress.people.extractCount.toLocaleString()} individual records`);
}

async function load() {
  const progress = loadProgress();
  if (progress.people.loadDone) {
    log.info(`Load already done (${progress.people.createdCount.toLocaleString()} created)`);
    return;
  }

  const totalRecords = ndjsonLineCount('raw_people');
  log.info(`Loading people into Twenty (${totalRecords.toLocaleString()} records, resuming from offset ${progress.people.loadOffset})...`);

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
    const payload = transformPerson(record);
    batch.push(payload);
    batchMeta.push({ notionId: record._notionId, dedupeKey: key });

    if (batch.length >= TWENTY_BATCH_SIZE) {
      try {
        const result = await twenty.createBatch('people', batch);
        const created = Array.isArray(result?.data?.people) ? result.data.people :
                        Array.isArray(result?.data) ? result.data :
                        Array.isArray(result) ? result : [];

        for (let i = 0; i < batchMeta.length; i++) {
          const twentyId = created[i]?.id || null;
          appendNdjson('person_map', {
            notionId: batchMeta[i].notionId,
            twentyId,
            dedupeKey: batchMeta[i].dedupeKey,
          });
        }

        progress.people.createdCount += created.length;
      } catch (err) {
        log.error(`Batch at offset ${lineIdx} failed: ${err.message}`);
        progress.people.loadOffset = lineIdx - batch.length + 1;
        saveProgress();
        throw err;
      }

      progress.people.loadOffset = lineIdx + 1;
      saveProgress();
      log.progress(lineIdx + 1, totalRecords, `created: ${progress.people.createdCount.toLocaleString()}, dupes: ${progress.people.skippedDupes.toLocaleString()}`);

      batch = [];
      batchMeta = [];
      await new Promise((r) => setTimeout(r, TWENTY_RATE_INTERVAL_MS));
    }
  }, progress.people.loadOffset);

  // Flush remaining
  if (batch.length > 0) {
    try {
      const result = await twenty.createBatch('people', batch);
      const created = Array.isArray(result?.data?.people) ? result.data.people :
                      Array.isArray(result?.data) ? result.data :
                      Array.isArray(result) ? result : [];

      for (let i = 0; i < batchMeta.length; i++) {
        const twentyId = created[i]?.id || null;
        appendNdjson('person_map', {
          notionId: batchMeta[i].notionId,
          twentyId,
          dedupeKey: batchMeta[i].dedupeKey,
        });
      }
      progress.people.createdCount += created.length;
    } catch (err) {
      log.error(`Final batch failed: ${err.message}`);
      saveProgress();
      throw err;
    }
  }

  log.progressDone();
  progress.people.loadDone = true;
  saveProgress();
  log.ok(`Loaded ${progress.people.createdCount.toLocaleString()} people (${progress.people.skippedDupes.toLocaleString()} dupes skipped)`);
}

export async function run() {
  await extract();
  await load();
  const progress = loadProgress();
  progress.currentPhase = 'aircraft';
  saveProgress();
}

export async function extractOnly() {
  await extract();
}
