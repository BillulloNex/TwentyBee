// Phase 2: Extract companies from Notion → dedupe → load into Twenty.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, appendNdjsonBatch, appendNdjson, ndjsonLineCount, streamNdjson, loadNdjsonSet } from '../lib/state.mjs';
import { extractDatabasePartitioned } from '../lib/notion.mjs';
import * as twenty from '../lib/twenty.mjs';
import { transformCompany, companyDedupeKey } from '../lib/transforms.mjs';
import { NOTION_DB, TWENTY_BATCH_SIZE, TWENTY_RATE_INTERVAL_MS } from '../config.mjs';

const log = createLogger('companies');

async function extract() {
  const progress = loadProgress();
  if (progress.companies.extractDone) {
    log.info(`Extraction already done (${progress.companies.extractCount.toLocaleString()} records)`);
    return;
  }

  log.info('Extracting companies from Notion (partitioned by first letter)...');

  const total = await extractDatabasePartitioned(NOTION_DB.companies, 'Company Name', {
    log,
    onPage: async (records, cursor) => {
      appendNdjsonBatch('raw_companies', records);
      progress.companies.extractCount += records.length;
      saveProgress();
      log.progress(progress.companies.extractCount, 150094, 'extracted');
    },
  });

  log.progressDone();
  progress.companies.extractDone = true;
  progress.companies.extractCount = ndjsonLineCount('raw_companies');
  saveProgress();
  log.ok(`Extracted ${progress.companies.extractCount.toLocaleString()} company records`);
}

async function load() {
  const progress = loadProgress();
  if (progress.companies.loadDone) {
    log.info(`Load already done (${progress.companies.createdCount.toLocaleString()} created)`);
    return;
  }

  const totalRecords = ndjsonLineCount('raw_companies');
  log.info(`Loading companies into Twenty (${totalRecords.toLocaleString()} records, resuming from offset ${progress.companies.loadOffset})...`);

  // Load existing dedup keys from previously imported records
  const dedup = await loadNdjsonSet('company_map', (r) => r.dedupeKey);
  log.info(`Loaded ${dedup.size.toLocaleString()} existing dedup keys`);

  let batch = [];
  let batchMeta = []; // Track notion IDs for mapping

  await streamNdjson('raw_companies', async (record, lineIdx) => {
    const key = companyDedupeKey(record);

    if (dedup.has(key)) {
      progress.companies.skippedDupes++;
      progress.companies.loadOffset = lineIdx + 1;
      return;
    }

    dedup.add(key);
    const payload = transformCompany(record);
    batch.push(payload);
    batchMeta.push({ notionId: record._notionId, dedupeKey: key });

    if (batch.length >= TWENTY_BATCH_SIZE) {
      // Send batch to Twenty
      try {
        const result = await twenty.createBatch('companies', batch);
        const created = Array.isArray(result?.data?.companies) ? result.data.companies :
                        Array.isArray(result?.data) ? result.data :
                        Array.isArray(result) ? result : [];

        // Save mappings
        for (let i = 0; i < batchMeta.length; i++) {
          const twentyId = created[i]?.id || null;
          appendNdjson('company_map', {
            notionId: batchMeta[i].notionId,
            twentyId,
            dedupeKey: batchMeta[i].dedupeKey,
          });
        }

        progress.companies.createdCount += created.length;
      } catch (err) {
        log.error(`Batch at offset ${lineIdx} failed: ${err.message}`);
        // Save progress and bail — will resume from here
        progress.companies.loadOffset = lineIdx - batch.length + 1;
        saveProgress();
        throw err;
      }

      progress.companies.loadOffset = lineIdx + 1;
      saveProgress();
      log.progress(lineIdx + 1, totalRecords, `created: ${progress.companies.createdCount.toLocaleString()}, dupes: ${progress.companies.skippedDupes.toLocaleString()}`);

      batch = [];
      batchMeta = [];

      // Rate limit
      await new Promise((r) => setTimeout(r, TWENTY_RATE_INTERVAL_MS));
    }
  }, progress.companies.loadOffset);

  // Flush remaining batch
  if (batch.length > 0) {
    try {
      const result = await twenty.createBatch('companies', batch);
      const created = Array.isArray(result?.data?.companies) ? result.data.companies :
                      Array.isArray(result?.data) ? result.data :
                      Array.isArray(result) ? result : [];

      for (let i = 0; i < batchMeta.length; i++) {
        const twentyId = created[i]?.id || null;
        appendNdjson('company_map', {
          notionId: batchMeta[i].notionId,
          twentyId,
          dedupeKey: batchMeta[i].dedupeKey,
        });
      }
      progress.companies.createdCount += created.length;
    } catch (err) {
      log.error(`Final batch failed: ${err.message}`);
      saveProgress();
      throw err;
    }
  }

  log.progressDone();
  progress.companies.loadDone = true;
  saveProgress();
  log.ok(`Loaded ${progress.companies.createdCount.toLocaleString()} companies (${progress.companies.skippedDupes.toLocaleString()} dupes skipped)`);
}

export async function run() {
  await extract();
  await load();
  const progress = loadProgress();
  progress.currentPhase = 'people';
  saveProgress();
}

// Extract-only mode: creates NDJSON files but skips loading into Twenty.
// Used when companies are already loaded but aircraft phase needs the raw data files.
export async function extractOnly() {
  await extract();
}
