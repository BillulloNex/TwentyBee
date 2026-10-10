// Phase 4: Build Aircraft records from raw company + people data, enrich with pricing, load into Twenty.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, appendNdjson, ndjsonLineCount, streamNdjson, loadNdjsonMap, appendNdjsonBatch } from '../lib/state.mjs';
import { extractDatabase } from '../lib/notion.mjs';
import * as twenty from '../lib/twenty.mjs';
import { transformAircraft, companyDedupeKey, personDedupeKey, priceKey, transformPrice } from '../lib/transforms.mjs';
import { NOTION_DB, TWENTY_BATCH_SIZE, TWENTY_RATE_INTERVAL_MS } from '../config.mjs';

const log = createLogger('aircraft');

async function extractPrices() {
  const progress = loadProgress();
  if (progress.prices.extractDone) {
    log.info(`Prices already extracted (${progress.prices.extractCount.toLocaleString()} records)`);
    return;
  }

  log.info('Extracting aircraft pricing data from Notion...');

  await extractDatabase(NOTION_DB.prices, {
    startCursor: progress.prices.extractCursor,
    log,
    onPage: async (records, cursor) => {
      appendNdjsonBatch('raw_prices', records);
      progress.prices.extractCursor = cursor;
      progress.prices.extractCount += records.length;
      saveProgress();
      log.progress(progress.prices.extractCount, 37958, 'prices extracted');
    },
  });

  log.progressDone();
  progress.prices.extractDone = true;
  progress.prices.extractCount = ndjsonLineCount('raw_prices');
  saveProgress();
  log.ok(`Extracted ${progress.prices.extractCount.toLocaleString()} price records`);
}

async function buildPriceMap() {
  log.info('Building price lookup map...');
  const priceMap = new Map();

  await streamNdjson('raw_prices', async (record) => {
    const price = transformPrice(record);
    if (price.key) priceMap.set(price.key, price);
  });

  log.ok(`Price map built: ${priceMap.size.toLocaleString()} entries`);
  return priceMap;
}

async function buildOwnerMaps() {
  log.info('Loading owner ID mappings...');

  // Company map: dedupeKey → twentyId
  const companyMap = new Map();
  const companyByNotion = new Map();
  await streamNdjson('company_map', async (record) => {
    if (record.twentyId) {
      companyMap.set(record.dedupeKey, record.twentyId);
      companyByNotion.set(record.notionId, record.twentyId);
    }
  });

  // Person map: dedupeKey → twentyId
  const personMap = new Map();
  const personByNotion = new Map();
  await streamNdjson('person_map', async (record) => {
    if (record.twentyId) {
      personMap.set(record.dedupeKey, record.twentyId);
      personByNotion.set(record.notionId, record.twentyId);
    }
  });

  log.ok(`Owner maps: ${companyMap.size.toLocaleString()} companies, ${personMap.size.toLocaleString()} people`);
  return { companyMap, companyByNotion, personMap, personByNotion };
}

async function load() {
  const progress = loadProgress();
  if (progress.aircraft.loadDone) {
    log.info(`Aircraft load already done (${progress.aircraft.createdCount.toLocaleString()} created)`);
    return;
  }

  // Extract prices first
  await extractPrices();

  // Build lookup maps
  const priceMap = await buildPriceMap();
  const { companyMap, companyByNotion, personMap, personByNotion } = await buildOwnerMaps();

  // Process company aircraft + individual aircraft
  const totalCompanies = ndjsonLineCount('raw_companies');
  const totalPeople = ndjsonLineCount('raw_people');
  const totalRecords = totalCompanies + totalPeople;

  log.info(`Loading aircraft into Twenty (${totalRecords.toLocaleString()} records, resuming from offset ${progress.aircraft.loadOffset})...`);

  let batch = [];
  let globalOffset = 0;

  // Process company-owned aircraft
  await streamNdjson('raw_companies', async (record, lineIdx) => {
    globalOffset = lineIdx;
    if (lineIdx < progress.aircraft.loadOffset) return;

    const key = companyDedupeKey(record);
    const ownerTwentyId = companyMap.get(key) || companyByNotion.get(record._notionId);
    const payload = transformAircraft(record, priceMap, ownerTwentyId, 'company');
    batch.push(payload);

    if (batch.length >= TWENTY_BATCH_SIZE) {
      try {
        await twenty.createBatch('aircrafts', batch);
        progress.aircraft.createdCount += batch.length;
      } catch (err) {
        log.error(`Aircraft batch at offset ${lineIdx} failed: ${err.message}`);
        progress.aircraft.loadOffset = lineIdx - batch.length + 1;
        saveProgress();
        throw err;
      }

      progress.aircraft.loadOffset = lineIdx + 1;
      saveProgress();
      log.progress(lineIdx + 1, totalRecords, `created: ${progress.aircraft.createdCount.toLocaleString()}`);

      batch = [];
      await new Promise((r) => setTimeout(r, TWENTY_RATE_INTERVAL_MS));
    }
  }, Math.min(progress.aircraft.loadOffset, totalCompanies));

  // Flush company batch remainder
  if (batch.length > 0) {
    try {
      await twenty.createBatch('aircrafts', batch);
      progress.aircraft.createdCount += batch.length;
    } catch (err) {
      log.error(`Company aircraft flush failed: ${err.message}`);
      saveProgress();
      throw err;
    }
    batch = [];
  }

  // Process individual-owned aircraft
  const peopleStartOffset = Math.max(0, progress.aircraft.loadOffset - totalCompanies);

  await streamNdjson('raw_people', async (record, lineIdx) => {
    const adjustedOffset = totalCompanies + lineIdx;
    if (adjustedOffset < progress.aircraft.loadOffset) return;

    const key = personDedupeKey(record);
    const ownerTwentyId = personMap.get(key) || personByNotion.get(record._notionId);
    const payload = transformAircraft(record, priceMap, ownerTwentyId, 'person');
    batch.push(payload);

    if (batch.length >= TWENTY_BATCH_SIZE) {
      try {
        await twenty.createBatch('aircrafts', batch);
        progress.aircraft.createdCount += batch.length;
      } catch (err) {
        log.error(`Aircraft batch at offset ${adjustedOffset} failed: ${err.message}`);
        progress.aircraft.loadOffset = adjustedOffset - batch.length + 1;
        saveProgress();
        throw err;
      }

      progress.aircraft.loadOffset = adjustedOffset + 1;
      saveProgress();
      log.progress(adjustedOffset + 1, totalRecords, `created: ${progress.aircraft.createdCount.toLocaleString()}`);

      batch = [];
      await new Promise((r) => setTimeout(r, TWENTY_RATE_INTERVAL_MS));
    }
  }, peopleStartOffset);

  // Final flush
  if (batch.length > 0) {
    try {
      await twenty.createBatch('aircrafts', batch);
      progress.aircraft.createdCount += batch.length;
    } catch (err) {
      log.error(`Final aircraft batch failed: ${err.message}`);
      saveProgress();
      throw err;
    }
  }

  log.progressDone();
  progress.aircraft.loadDone = true;
  saveProgress();
  log.ok(`Loaded ${progress.aircraft.createdCount.toLocaleString()} aircraft records`);
}

export async function run() {
  await load();
}
