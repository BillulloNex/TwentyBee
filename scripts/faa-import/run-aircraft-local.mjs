#!/usr/bin/env node

// Local runner: extract data from Notion, then load aircraft into Twenty.
// Skips companies/people loading (already done), only creates NDJSON files + loads aircraft.

import { createLogger } from './lib/logger.mjs';
import * as twenty from './lib/twenty.mjs';
import * as companiesPhase from './phases/import-companies.mjs';
import * as peoplePhase from './phases/import-people.mjs';
import * as aircraftPhase from './phases/import-aircraft.mjs';
import { ndjsonLineCount } from './lib/state.mjs';
import { writeFileSync, mkdirSync } from 'fs';

// Crash handlers
function crashLog(label, err) {
  const msg = `[CRASH] ${label}: ${err?.stack || err?.message || err}\n`;
  process.stderr.write(msg);
  try {
    mkdirSync('/tmp/faa-import-state', { recursive: true });
    writeFileSync('/tmp/faa-import-state/error.log', msg, { flag: 'a' });
  } catch { /* ignore */ }
}
process.on('uncaughtException', (err) => { crashLog('uncaughtException', err); process.exit(1); });
process.on('unhandledRejection', (err) => { crashLog('unhandledRejection', err); process.exit(1); });

const log = createLogger('local');

async function main() {
  const start = Date.now();
  
  log.info('=== FAA Aircraft Import — Local Runner ===\n');

  // Test connection
  const test = await twenty.testConnection();
  if (!test.ok) {
    log.error(`Cannot connect to Twenty: ${test.error}`);
    process.exit(1);
  }
  log.ok('Connected to Twenty CRM\n');

  // Phase 1: Extract companies from Notion (extract only — no loading)
  log.info('📦 Phase 1/3: Extracting companies from Notion...');
  await companiesPhase.extractOnly();
  log.ok(`Companies extracted: ${ndjsonLineCount('raw_companies').toLocaleString()} records\n`);

  // Phase 2: Extract people from Notion (extract only — no loading)
  log.info('📦 Phase 2/3: Extracting people from Notion...');
  await peoplePhase.extractOnly();
  log.ok(`People extracted: ${ndjsonLineCount('raw_people').toLocaleString()} records\n`);

  // Phase 3: Load aircraft (prices extraction + owner maps + aircraft loading)
  log.info('✈️  Phase 3/3: Loading aircraft into Twenty...');
  await aircraftPhase.run();
  log.ok(`Aircraft loaded: ${ndjsonLineCount('raw_prices').toLocaleString()} price records used\n`);

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
  log.ok(`🎉 All done in ${elapsed} minutes!`);
}

// Graceful shutdown
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log.warn(`\n${sig} received — progress saved. Re-run to resume.`);
    process.exit(0);
  });
}

await main();
