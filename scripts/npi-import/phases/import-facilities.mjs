// Phase 2: Import healthcare facilities into the healthcareFacility custom object.
// Sources: hospitals, health centers, nursing homes, dialysis, home health, hospice, ASCs.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, appendNdjson, appendNdjsonBatch, loadNdjsonSet } from '../lib/state.mjs';
import { streamCsv } from '../lib/csv-reader.mjs';
import * as twenty from '../lib/twenty.mjs';
import {
  transformHospital, transformHealthCenter, transformNursingHome,
  transformDialysis, transformHomeHealth, transformHospice,
  transformAmbulatorySurgery, facilityDedupeKey,
} from '../lib/transforms.mjs';
import { DATA_FILES, TWENTY_BATCH_SIZE, TWENTY_RATE_INTERVAL_MS } from '../config.mjs';

const log = createLogger('facilities');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Extract created items from a Twenty batch response.
// The API returns data under keys like createHealthcareFacilities, createPeople, etc.
function extractBatchItems(result) {
  if (!result?.data) return [];
  const data = result.data;
  // Find the first array value in data
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key])) return data[key];
  }
  if (Array.isArray(data)) return data;
  return [];
}

// Source definitions: key → { file, transform, label }
const SOURCES = [
  { key: 'hospitals', file: DATA_FILES.cmsHospitals, transform: transformHospital, label: 'CMS Hospitals' },
  { key: 'healthCenters', file: DATA_FILES.hrsaHealthCenters, transform: transformHealthCenter, label: 'HRSA Health Centers' },
  { key: 'nursingHomes', file: DATA_FILES.cmsNursingHomes, transform: transformNursingHome, label: 'CMS Nursing Homes' },
  { key: 'dialysis', file: DATA_FILES.cmsDialysis, transform: transformDialysis, label: 'CMS Dialysis' },
  { key: 'homeHealth', file: DATA_FILES.cmsHomeHealth, transform: transformHomeHealth, label: 'CMS Home Health' },
  { key: 'hospice', file: DATA_FILES.cmsHospice, transform: transformHospice, label: 'CMS Hospice' },
  { key: 'ambulatorySurgery', file: DATA_FILES.cmsAmbulatorySurgery, transform: transformAmbulatorySurgery, label: 'CMS Ambulatory Surgery' },
];

async function importSource(source, dedup, progress) {
  const srcProgress = progress.facilities[source.key] || {};
  if (srcProgress.done) {
    log.info(`  "${source.label}" already done (${(srcProgress.count || 0).toLocaleString()} records)`);
    return;
  }

  log.info(`  Importing "${source.label}"...`);

  let batch = [];
  let batchMeta = [];
  let count = srcProgress.count || 0;
  let created = 0;
  let dupes = 0;

  await streamCsv(source.file, async (record) => {
    const payload = source.transform(record);
    const key = facilityDedupeKey(payload);

    if (dedup.has(key)) {
      dupes++;
      return;
    }
    dedup.add(key);
    batch.push(payload);
    batchMeta.push({ key, facilityId: payload.facilityId || payload.ccn || key });

    if (batch.length >= TWENTY_BATCH_SIZE) {
      try {
        const result = await twenty.createBatch('healthcareFacilities', batch);
        const items = extractBatchItems(result);

        for (let i = 0; i < batchMeta.length; i++) {
          const twentyId = items[i]?.id || null;
          appendNdjson('facility_map', {
            facilityId: batchMeta[i].facilityId,
            dedupeKey: batchMeta[i].key,
            twentyId,
          });
        }

        created += items.length;
        count += batch.length;
      } catch (err) {
        log.error(`  Batch failed: ${err.message.slice(0, 300)}`);
        srcProgress.count = count;
        saveProgress();
        throw err;
      }

      if (count % 2000 === 0) {
        srcProgress.count = count;
        saveProgress();
        log.progress(count, 0, `created: ${created.toLocaleString()}, dupes: ${dupes.toLocaleString()}`);
      }

      batch = [];
      batchMeta = [];
      await sleep(TWENTY_RATE_INTERVAL_MS);
    }
  });

  // Flush remaining
  if (batch.length > 0) {
    try {
      const result = await twenty.createBatch('healthcareFacilities', batch);
      const items = extractBatchItems(result);

      for (let i = 0; i < batchMeta.length; i++) {
        const twentyId = items[i]?.id || null;
        appendNdjson('facility_map', {
          facilityId: batchMeta[i].facilityId,
          dedupeKey: batchMeta[i].key,
          twentyId,
        });
      }

      created += items.length;
      count += batch.length;
    } catch (err) {
      log.error(`  Final batch failed: ${err.message.slice(0, 300)}`);
      srcProgress.count = count;
      saveProgress();
      throw err;
    }
  }

  srcProgress.done = true;
  srcProgress.count = count;
  srcProgress.created = created;
  srcProgress.dupes = dupes;
  progress.facilities[source.key] = srcProgress;
  saveProgress();
  log.ok(`  "${source.label}" done — ${created.toLocaleString()} created, ${dupes.toLocaleString()} dupes`);
}

export async function run() {
  const progress = loadProgress();
  if (progress.facilities.loadDone) {
    log.info('Facility import already completed, skipping');
    return;
  }

  log.info('Importing healthcare facilities into Twenty CRM...');

  // Load existing dedup keys
  const dedup = await loadNdjsonSet('facility_map', (r) => r.dedupeKey);
  log.info(`${dedup.size.toLocaleString()} existing facility dedup keys loaded`);

  let totalCreated = 0;
  let totalDupes = 0;

  for (const source of SOURCES) {
    await importSource(source, dedup, progress);
    const s = progress.facilities[source.key] || {};
    totalCreated += s.created || 0;
    totalDupes += s.dupes || 0;
  }

  progress.facilities.loadDone = true;
  progress.facilities.createdCount = totalCreated;
  progress.facilities.skippedDupes = totalDupes;
  progress.currentPhase = 'quality';
  saveProgress();

  log.ok(`Facility import done — ${totalCreated.toLocaleString()} created, ${totalDupes.toLocaleString()} dupes across all sources`);
}
