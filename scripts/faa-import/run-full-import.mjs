#!/usr/bin/env node

// Full clean import: nuke existing data → extract all from Notion → load fresh.
// Guarantees zero duplicates by starting from a clean slate.

import { TWENTY_API_KEY, TWENTY_BASE_URL } from './config.mjs';
import { createLogger } from './lib/logger.mjs';
import * as companiesPhase from './phases/import-companies.mjs';
import * as peoplePhase from './phases/import-people.mjs';
import * as aircraftPhase from './phases/import-aircraft.mjs';
import { ndjsonLineCount } from './lib/state.mjs';
import { rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const log = createLogger('import');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiRequest(method, path) {
  const res = await fetch(`${TWENTY_BASE_URL}/rest${path}`, {
    method,
    headers: { Authorization: `Bearer ${TWENTY_API_KEY}` },
  });
  return res;
}

async function getCount(objectName) {
  const res = await apiRequest('GET', `/${objectName}?limit=1`);
  const data = await res.json();
  return data.totalCount || 0;
}

// Bulk delete with hour-based chunking to avoid query timeouts
async function nukeObject(objectName) {
  const count = await getCount(objectName);
  if (count === 0) {
    log.ok(`${objectName}: already empty`);
    return;
  }

  log.info(`Deleting ${count.toLocaleString()} ${objectName}...`);

  // Try single bulk delete first
  const res = await fetch(`${TWENTY_BASE_URL}/rest/${objectName}?filter=createdAt%5Bgte%5D:2020-01-01T00:00:00Z`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TWENTY_API_KEY}` },
  });

  const remaining = await getCount(objectName);
  if (remaining === 0) {
    log.ok(`${objectName}: deleted ${count.toLocaleString()} records`);
    return;
  }

  // Fallback: hour-based chunking
  log.info(`${remaining.toLocaleString()} remaining, using hourly chunks...`);
  for (let day = 7; day <= 9; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const h = String(hour).padStart(2, '0');
      await fetch(
        `${TWENTY_BASE_URL}/rest/${objectName}?filter=createdAt%5Bgte%5D:2026-10-${String(day).padStart(2,'0')}T${h}:00:00Z,createdAt%5Blte%5D:2026-10-${String(day).padStart(2,'0')}T${h}:59:59Z`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${TWENTY_API_KEY}` } }
      );
    }
  }

  // Final cleanup
  await fetch(`${TWENTY_BASE_URL}/rest/${objectName}?filter=createdAt%5Blte%5D:2026-12-31T00:00:00Z`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TWENTY_API_KEY}` },
  });

  const final = await getCount(objectName);
  log.ok(`${objectName}: ${final === 0 ? 'fully cleared' : final + ' stubbornly remain'}`);
}

async function main() {
  const start = Date.now();

  log.info('=== FAA Full Import — Clean Slate ===\n');

  // Test connection
  const test = await apiRequest('GET', '/companies?limit=1');
  if (!test.ok) { log.error('Cannot connect to Twenty'); process.exit(1); }
  log.ok('Connected to Twenty CRM\n');

  // Step 1: Nuke existing companies and people (keep aircraft)
  log.info('🗑️  Step 1/4: Clearing existing companies & people...');
  await nukeObject('companies');
  await nukeObject('people');
  log.ok('Clean slate ready\n');

  // Step 2: Reset local extraction state
  log.info('📁 Step 2/4: Resetting local state...');
  try { rmSync(resolve(__dirname, 'state'), { recursive: true, force: true }); } catch {}
  mkdirSync(resolve(__dirname, 'state'), { recursive: true });
  log.ok('State directory reset\n');

  // Step 3: Extract from Notion (partitioned to bypass 10K limit)
  log.info('📦 Step 3/4: Extracting from Notion...\n');

  log.info('--- Companies (expect ~150K) ---');
  await companiesPhase.extractOnly();
  const companyCount = ndjsonLineCount('raw_companies');
  log.ok(`Companies extracted: ${companyCount.toLocaleString()}\n`);

  log.info('--- People (expect ~128K) ---');
  await peoplePhase.extractOnly();
  const peopleCount = ndjsonLineCount('raw_people');
  log.ok(`People extracted: ${peopleCount.toLocaleString()}\n`);

  // Step 4: Load into Twenty
  log.info('📤 Step 4/4: Loading into Twenty...\n');

  log.info('--- Loading companies ---');
  await companiesPhase.run();
  log.ok(`Companies loaded: ${(await getCount('companies')).toLocaleString()}\n`);

  log.info('--- Loading people ---');
  await peoplePhase.run();
  log.ok(`People loaded: ${(await getCount('people')).toLocaleString()}\n`);

  // Final report
  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
  log.ok('=== Final State ===');
  log.ok(`  Companies: ${(await getCount('companies')).toLocaleString()}`);
  log.ok(`  People:    ${(await getCount('people')).toLocaleString()}`);
  log.ok(`  Aircraft:  ${(await getCount('aircrafts')).toLocaleString()}`);
  log.ok(`\n🎉 Complete in ${elapsed} minutes!`);
}

// Graceful shutdown
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log.warn(`\n${sig} — progress saved in state/. Re-run to resume.`);
    process.exit(0);
  });
}
process.on('uncaughtException', (err) => { log.error(`CRASH: ${err.stack}`); process.exit(1); });
process.on('unhandledRejection', (err) => { log.error(`CRASH: ${err?.stack || err}`); process.exit(1); });

await main();
