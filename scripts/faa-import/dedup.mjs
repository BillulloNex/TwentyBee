#!/usr/bin/env node

// Deduplicate companies and people in Twenty CRM.
// Groups records by dedup key, keeps the oldest, deletes the rest.

import { TWENTY_API_KEY, TWENTY_BASE_URL } from './config.mjs';
import { createLogger } from './lib/logger.mjs';

const log = createLogger('dedup');
const BATCH_SIZE = 200;
const RATE_MS = 100;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiRequest(method, path, body = null) {
  const url = `${TWENTY_BASE_URL}/rest${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${TWENTY_API_KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  let retries = 0;
  while (true) {
    const res = await fetch(url, opts);
    if (res.status === 429) {
      retries++;
      if (retries > 10) throw new Error(`Rate limited after ${retries} retries`);
      await sleep(Math.max(parseInt(res.headers.get('retry-after') || '5') * 1000, 5000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (retries < 3 && res.status >= 500) { retries++; await sleep(2000 * retries); continue; }
      throw new Error(`API ${res.status} ${method} ${path}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }
}

// Paginate through ALL records of an object type
async function fetchAll(objectName, fields) {
  const records = [];
  let cursor = null;
  let page = 0;

  while (true) {
    const params = new URLSearchParams({ limit: String(BATCH_SIZE) });
    if (cursor) params.set('after', cursor);

    const resp = await apiRequest('GET', `/${objectName}?${params}`);
    const data = resp?.data?.[objectName] || resp?.data || [];
    records.push(...data);
    page++;

    if (page % 50 === 0) {
      log.info(`  Fetched ${records.length.toLocaleString()} ${objectName}...`);
    }

    const pageInfo = resp?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
    await sleep(RATE_MS);
  }

  return records;
}

// Delete records by ID — uses individual DELETEs with concurrency
async function batchDelete(objectName, ids) {
  let deleted = 0;
  const total = ids.length;

  // Process in chunks of 20 concurrent deletes
  const CONCURRENCY = 20;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const chunk = ids.slice(i, i + CONCURRENCY);
    const promises = chunk.map(id =>
      apiRequest('DELETE', `/${objectName}/${id}`)
        .then(() => { deleted++; })
        .catch(err => {
          // 404 = already deleted, skip
          if (!err.message.includes('404')) {
            log.warn(`Delete failed for ${id}: ${err.message}`);
          }
          deleted++;
        })
    );
    await Promise.all(promises);

    if ((i + CONCURRENCY) % 1000 < CONCURRENCY) {
      const pct = ((deleted / total) * 100).toFixed(1);
      log.progress(deleted, total, `deleted`);
    }

    await sleep(RATE_MS);
  }

  return deleted;
}

// Build dedup key for companies: name|city|state (lowercased)
function companyKey(record) {
  const name = (record.name || '').toLowerCase().trim();
  const city = (record.address?.addressCity || '').toLowerCase().trim();
  const state = (record.address?.addressState || '').toLowerCase().trim();
  return `${name}|${city}|${state}`;
}

// Build dedup key for people: firstName|lastName|city|state (lowercased)
function personKey(record) {
  const first = (record.name?.firstName || '').toLowerCase().trim();
  const last = (record.name?.lastName || '').toLowerCase().trim();
  const city = (record.addressCity || '').toLowerCase().trim();
  const state = (record.addressState || '').toLowerCase().trim();
  return `${first}|${last}|${city}|${state}`;
}

async function dedup(objectName, keyFn) {
  log.info(`\n📋 Fetching all ${objectName}...`);
  const records = await fetchAll(objectName);
  log.ok(`Fetched ${records.length.toLocaleString()} ${objectName}`);

  // Group by dedup key
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const uniqueCount = groups.size;
  const dupeGroups = [...groups.values()].filter(g => g.length > 1);
  const dupeCount = records.length - uniqueCount;

  log.info(`Unique keys: ${uniqueCount.toLocaleString()}`);
  log.info(`Duplicate records to remove: ${dupeCount.toLocaleString()}`);
  log.info(`Duplicate groups: ${dupeGroups.length.toLocaleString()}`);

  if (dupeCount === 0) {
    log.ok(`No duplicates found!`);
    return;
  }

  // For each group, keep the OLDEST record (earliest createdAt), delete the rest
  const idsToDelete = [];
  for (const group of dupeGroups) {
    group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    // Keep first (oldest), delete rest
    for (let i = 1; i < group.length; i++) {
      idsToDelete.push(group[i].id);
    }
  }

  log.info(`\n🗑️  Deleting ${idsToDelete.length.toLocaleString()} duplicate ${objectName}...`);
  const deleted = await batchDelete(objectName, idsToDelete);
  log.progressDone();
  log.ok(`Deleted ${deleted.toLocaleString()} duplicate ${objectName}`);

  // Verify
  const resp = await apiRequest('GET', `/${objectName}?limit=1`);
  const remaining = resp?.totalCount || '?';
  log.ok(`Remaining ${objectName}: ${remaining.toLocaleString()}`);
}

async function main() {
  const start = Date.now();
  log.info('=== Twenty CRM Deduplication ===\n');

  // Test connection
  const test = await apiRequest('GET', '/companies?limit=1').catch(() => null);
  if (!test) { log.error('Cannot connect to Twenty'); process.exit(1); }
  log.ok('Connected to Twenty CRM');

  await dedup('companies', companyKey);
  await dedup('people', personKey);

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
  log.ok(`\n🎉 Deduplication complete in ${elapsed} minutes!`);
}

// Graceful shutdown
let shuttingDown = false;
process.on('SIGINT', () => { if (shuttingDown) process.exit(1); shuttingDown = true; log.warn('Stopping...'); process.exit(0); });
process.on('SIGTERM', () => { if (shuttingDown) process.exit(1); shuttingDown = true; process.exit(0); });

await main();
