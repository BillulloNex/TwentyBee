// Phase 3: Import quality measures into the qualityMeasure custom object.
// Sources: complications/deaths, HAI, HCAHPS, timely/effective care, readmissions, interop.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, appendNdjsonBatch } from '../lib/state.mjs';
import { streamCsv } from '../lib/csv-reader.mjs';
import * as twenty from '../lib/twenty.mjs';
import { extractBatchItems } from '../lib/twenty.mjs';
import {
  transformComplicationsMeasure, transformHaiMeasure, transformHcahpsMeasure,
  transformTimelyCareMeasure, transformReadmissionMeasure, transformInteropMeasure,
} from '../lib/transforms.mjs';
import { DATA_FILES, TWENTY_BATCH_SIZE, TWENTY_RATE_INTERVAL_MS } from '../config.mjs';

const log = createLogger('quality');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const SOURCES = [
  { key: 'complications', file: DATA_FILES.cmsComplicationsDeaths, transform: transformComplicationsMeasure, label: 'Complications & Deaths' },
  { key: 'hai', file: DATA_FILES.cmsHaiHospital, transform: transformHaiMeasure, label: 'Hospital-Acquired Infections' },
  { key: 'hcahps', file: DATA_FILES.cmsHcahps, transform: transformHcahpsMeasure, label: 'Patient Experience (HCAHPS)' },
  { key: 'timelyCare', file: DATA_FILES.cmsTimelyEffectiveCare, transform: transformTimelyCareMeasure, label: 'Timely & Effective Care' },
  { key: 'readmissions', file: DATA_FILES.cmsHospitalReadmissions, transform: transformReadmissionMeasure, label: 'Hospital Readmissions' },
  { key: 'interop', file: DATA_FILES.cmsPromotingInterop, transform: transformInteropMeasure, label: 'Promoting Interop' },
];

async function importSource(source, progress) {
  const srcProgress = progress.quality[source.key] || {};
  if (srcProgress.done) {
    log.info(`  "${source.label}" already done (${(srcProgress.count || 0).toLocaleString()} records)`);
    return;
  }

  const resumeOffset = srcProgress.count || 0;
  if (resumeOffset > 0) {
    log.info(`  Resuming "${source.label}" from row ${resumeOffset.toLocaleString()}...`);
  } else {
    log.info(`  Importing "${source.label}"...`);
  }

  let batch = [];
  let count = 0; // rows read from CSV
  let created = srcProgress.created || 0;

  await streamCsv(source.file, async (record) => {
    count++;

    // Skip rows already processed in a previous run
    if (count <= resumeOffset) return;

    const payload = source.transform(record);
    batch.push(payload);

    if (batch.length >= TWENTY_BATCH_SIZE) {
      try {
        const result = await twenty.createBatch('qualityMeasures', batch);
        const items = extractBatchItems(result);
        created += items.length;
      } catch (err) {
        log.error(`  Batch failed at count ${count}: ${err.message.slice(0, 300)}`);
        srcProgress.count = count;
        srcProgress.created = created;
        progress.quality[source.key] = srcProgress;
        saveProgress();
        throw err;
      }

      srcProgress.count = count;
      srcProgress.created = created;
      progress.quality[source.key] = srcProgress;

      if (count % 5000 === 0) {
        saveProgress();
        log.progress(count, 0, `created: ${created.toLocaleString()}`);
      }

      batch = [];
      await sleep(TWENTY_RATE_INTERVAL_MS);
    }
  });

  // Flush remaining
  if (batch.length > 0) {
    try {
      const result = await twenty.createBatch('qualityMeasures', batch);
      const items = extractBatchItems(result);
      created += items.length;
      count += 0; // count is already correct from the loop
    } catch (err) {
      log.error(`  Final batch failed: ${err.message.slice(0, 300)}`);
      srcProgress.count = count;
      srcProgress.created = created;
      progress.quality[source.key] = srcProgress;
      saveProgress();
      throw err;
    }
  }

  srcProgress.done = true;
  srcProgress.count = count;
  srcProgress.created = created;
  progress.quality[source.key] = srcProgress;
  saveProgress();
  log.ok(`  "${source.label}" done — ${created.toLocaleString()} created from ${count.toLocaleString()} rows`);
}

export async function run() {
  const progress = loadProgress();
  if (progress.quality.loadDone) {
    log.info('Quality measure import already completed, skipping');
    return;
  }

  log.info('Importing quality measures into Twenty CRM...');

  let totalCreated = 0;

  for (const source of SOURCES) {
    await importSource(source, progress);
    const s = progress.quality[source.key] || {};
    totalCreated += s.created || 0;
  }

  progress.quality.loadDone = true;
  progress.quality.createdCount = totalCreated;
  progress.currentPhase = 'people';
  saveProgress();

  log.ok(`Quality measure import done — ${totalCreated.toLocaleString()} measures created`);
}
