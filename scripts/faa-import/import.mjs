#!/usr/bin/env node

// FAA Aircraft Owner → Twenty CRM Import
// Usage:
//   node import.mjs              # Run all phases (resumable)
//   node import.mjs --phase X    # Run a specific phase: schema, companies, people, aircraft
//   node import.mjs --status     # Show current progress
//   node import.mjs --reset      # Reset all progress and start fresh

import { loadProgress, saveProgress, resetProgress, ndjsonLineCount } from './lib/state.mjs';
import { createLogger } from './lib/logger.mjs';
import * as twenty from './lib/twenty.mjs';
import { PHASES } from './config.mjs';

import * as schemaPhase from './phases/setup-schema.mjs';
import * as companiesPhase from './phases/import-companies.mjs';
import * as peoplePhase from './phases/import-people.mjs';
import * as aircraftPhase from './phases/import-aircraft.mjs';

import { writeFileSync, mkdirSync } from 'fs';

// Crash handlers — log full error before exit so CF container logs show the reason
function crashLog(label, err) {
  const msg = `[CRASH] ${label}: ${err?.stack || err?.message || err}\n`;
  process.stderr.write(msg);
  try {
    mkdirSync('/app/state', { recursive: true });
    writeFileSync('/app/state/error.log', msg, { flag: 'a' });
  } catch { /* ignore */ }
}
process.on('uncaughtException', (err) => { crashLog('uncaughtException', err); process.exit(1); });
process.on('unhandledRejection', (err) => { crashLog('unhandledRejection', err); process.exit(1); });

const log = createLogger('main');

const phaseRunners = {
  schema: schemaPhase.run,
  companies: companiesPhase.run,
  people: peoplePhase.run,
  aircraft: aircraftPhase.run,
};

function printStatus() {
  const p = loadProgress();
  console.log('\n📊 FAA → Twenty CRM Import Status\n');
  console.log(`  Current Phase: ${p.currentPhase}`);
  console.log(`  Last Saved:    ${p.lastSavedAt || 'never'}\n`);

  console.log('  Phase       │ Status');
  console.log('  ────────────┼───────────────────────────────────');
  console.log(`  Schema      │ ${p.schema.completed ? '✅ Done' : '⏳ Pending'}`);
  console.log(`  Companies   │ Extract: ${p.companies.extractDone ? `✅ ${p.companies.extractCount.toLocaleString()} records` : `⏳ ${p.companies.extractCount.toLocaleString()} so far`}`);
  console.log(`              │ Load:    ${p.companies.loadDone ? `✅ ${p.companies.createdCount.toLocaleString()} created` : `⏳ ${p.companies.createdCount.toLocaleString()} created, ${p.companies.skippedDupes.toLocaleString()} dupes`}`);
  console.log(`  People      │ Extract: ${p.people.extractDone ? `✅ ${p.people.extractCount.toLocaleString()} records` : `⏳ ${p.people.extractCount.toLocaleString()} so far`}`);
  console.log(`              │ Load:    ${p.people.loadDone ? `✅ ${p.people.createdCount.toLocaleString()} created` : `⏳ ${p.people.createdCount.toLocaleString()} created, ${p.people.skippedDupes.toLocaleString()} dupes`}`);
  console.log(`  Prices      │ Extract: ${p.prices.extractDone ? `✅ ${p.prices.extractCount.toLocaleString()} records` : `⏳ ${p.prices.extractCount.toLocaleString()} so far`}`);
  console.log(`  Aircraft    │ Load:    ${p.aircraft.loadDone ? `✅ ${p.aircraft.createdCount.toLocaleString()} created` : `⏳ ${p.aircraft.createdCount.toLocaleString()} created`}`);
  console.log('');

  // State files
  const files = ['raw_companies', 'raw_people', 'raw_prices', 'company_map', 'person_map'];
  console.log('  Data Files:');
  for (const f of files) {
    const count = ndjsonLineCount(f);
    if (count > 0) console.log(`    ${f}.ndjson: ${count.toLocaleString()} lines`);
  }
  console.log('');
}

async function runPhase(phaseName) {
  const runner = phaseRunners[phaseName];
  if (!runner) {
    log.error(`Unknown phase: ${phaseName}. Valid: ${PHASES.join(', ')}`);
    process.exit(1);
  }

  log.info(`Running phase: ${phaseName}`);
  const start = Date.now();

  try {
    await runner();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.ok(`Phase "${phaseName}" completed in ${elapsed}s`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.error(`Phase "${phaseName}" failed after ${elapsed}s: ${err.message}`);
    log.info('Progress has been saved. Re-run to resume from where you left off.');
    process.exit(1);
  }
}

// Report phase completion to DO storage (survives all crashes)
async function reportPhaseDone(phase) {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) return; // local run — no DO to report to
  try {
    const resp = await fetch(`${workerUrl}/phase-done?phase=${phase}`);
    const data = await resp.json();
    log.info(`Phase "${phase}" reported to DO. Phases done: ${JSON.stringify(data.phasesDone)}`);
  } catch (err) {
    log.warn(`Could not report phase "${phase}" to DO: ${err.message}`);
  }
}

// Get completed phases from DO storage (survives all crashes)
async function getCompletedPhases() {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) return []; // local run — no DO
  try {
    const resp = await fetch(`${workerUrl}/phases`);
    const data = await resp.json();
    return data.phasesDone || [];
  } catch {
    return [];
  }
}

async function runAll() {
  const progress = loadProgress();

  log.info('Starting FAA → Twenty CRM import pipeline');

  // Check DO storage for already-completed phases (crash-proof)
  const completedPhases = await getCompletedPhases();
  if (completedPhases.length > 0) {
    log.info(`DO reports these phases are done: ${completedPhases.join(', ')}`);
  }

  // Test connection
  const test = await twenty.testConnection();
  if (!test.ok) {
    log.error(`Cannot connect to Twenty CRM: ${test.error}`);
    log.info('Check TWENTY_API_KEY and TWENTY_BASE_URL in .env');
    process.exit(1);
  }
  log.ok('Connected to Twenty CRM\n');

  // Phases that need their raw data extracted even if loading is done
  // (aircraft phase depends on raw_companies + raw_people NDJSON files)
  const extractOnlyPhases = { companies: companiesPhase, people: peoplePhase };

  for (const phase of PHASES) {
    if (completedPhases.includes(phase)) {
      // For companies/people: still extract from Notion (creates NDJSON files)
      // but skip the loading step (data already in Twenty)
      if (extractOnlyPhases[phase]) {
        log.info(`Phase "${phase}" already loaded — running extract-only for downstream data files`);
        await extractOnlyPhases[phase].extractOnly();
        log.ok(`Extract-only for "${phase}" complete`);
      } else {
        log.info(`Skipping phase "${phase}" — already completed`);
      }
      continue;
    }

    await runPhase(phase);
    await reportPhaseDone(phase);
    console.log('');
  }

  log.ok('🎉 All phases complete! Import finished.');
  printStatus();
}

// --- CLI ---

const args = process.argv.slice(2);

// Graceful shutdown
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (shuttingDown) {
      log.warn('Force shutdown');
      process.exit(1);
    }
    shuttingDown = true;
    log.warn(`\nReceived ${sig} — saving progress and shutting down...`);
    try {
      saveProgress();
      log.ok('Progress saved. Re-run to continue where you left off.');
    } catch {
      // Best-effort
    }
    process.exit(0);
  });
}

if (args.includes('--status')) {
  printStatus();
} else if (args.includes('--reset')) {
  resetProgress();
  log.ok('Progress reset. All state files cleared.');
} else if (args.includes('--phase')) {
  const phaseIdx = args.indexOf('--phase');
  const phaseName = args[phaseIdx + 1];
  if (!phaseName) {
    log.error('Specify a phase: --phase schema|companies|people|aircraft');
    process.exit(1);
  }
  await runPhase(phaseName);
} else {
  await runAll();
}
