#!/usr/bin/env node

// NPI/NPPES Healthcare Provider → Twenty CRM Import
// PARALLEL pipeline with independent workers:
//   Worker A: quality       — Import ~930K quality measures (resumes from progress)
//   Worker B: people        — Import ~3.4M CMS doctors/clinicians
//            → enrich       — Stream NPPES to add taxonomy codes, license info
//            → affiliations — Link providers to facilities
//
// Usage:
//   node import.mjs              # Run all phases in parallel
//   node import.mjs --phase X    # Run a specific phase
//   node import.mjs --status     # Show current progress
//   node import.mjs --reset      # Reset all progress and start fresh
//   node import.mjs --limit N    # Limit records processed (for testing)

import { loadProgress, saveProgress, resetProgress, ndjsonLineCount } from './lib/state.mjs';
import { createLogger } from './lib/logger.mjs';
import * as twenty from './lib/twenty.mjs';
import { PHASES } from './config.mjs';

import * as schemaPhase from './phases/setup-schema.mjs';
import * as facilitiesPhase from './phases/import-facilities.mjs';
import * as qualityPhase from './phases/import-quality.mjs';
import * as peoplePhase from './phases/import-people.mjs';
import * as enrichPhase from './phases/enrich-nppes.mjs';
import * as affiliationsPhase from './phases/import-affiliations.mjs';

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';

// --- Heartbeat System ---
// Writes a heartbeat file every 30s so external monitors can verify liveness
const HEARTBEAT_FILE = 'state/heartbeat.json';
const HEARTBEAT_INTERVAL_MS = 30_000;
let heartbeatTimer = null;
const workerStatus = {};

function startHeartbeat() {
  writeHeartbeat();
  heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  // Don't block process exit
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

function writeHeartbeat() {
  try {
    const progress = loadProgress();
    const hb = {
      alive: true,
      pid: process.pid,
      uptime_s: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      workers: { ...workerStatus },
      progress: {
        quality: {
          complications: progress.quality?.complications?.count || 0,
          hai: progress.quality?.hai?.count || 0,
          hcahps: progress.quality?.hcahps?.count || 0,
          timelyCare: progress.quality?.timelyCare?.count || 0,
          readmissions: progress.quality?.readmissions?.count || 0,
          interop: progress.quality?.interop?.count || 0,
          done: progress.quality?.loadDone || false,
        },
        people: {
          extracted: progress.people?.extractCount || 0,
          created: progress.people?.createdCount || 0,
          dupes: progress.people?.skippedDupes || 0,
          extractDone: progress.people?.extractDone || false,
          loadDone: progress.people?.loadDone || false,
        },
        enrich: {
          scanned: progress.enrich?.nppesProcessed || 0,
          enriched: progress.enrich?.enrichedPeople || 0,
          done: progress.enrich?.done || false,
        },
        affiliations: {
          created: progress.affiliations?.created || 0,
          processed: progress.affiliations?.processed || 0,
          done: progress.affiliations?.done || false,
        },
      },
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
    mkdirSync('state', { recursive: true });
    writeFileSync(HEARTBEAT_FILE, JSON.stringify(hb, null, 2) + '\n');
  } catch { /* best effort */ }
}

function updateWorkerStatus(name, status, detail = '') {
  workerStatus[name] = { status, detail, updatedAt: new Date().toISOString() };
  writeHeartbeat();
}

// --- Crash handlers ---
function crashLog(label, err) {
  const msg = `[CRASH] ${label}: ${err?.stack || err?.message || err}\n`;
  process.stderr.write(msg);
  try {
    mkdirSync('state', { recursive: true });
    writeFileSync('state/error.log', msg, { flag: 'a' });
  } catch { /* ignore */ }
}
process.on('uncaughtException', (err) => { crashLog('uncaughtException', err); process.exit(1); });
process.on('unhandledRejection', (err) => { crashLog('unhandledRejection', err); process.exit(1); });

const log = createLogger('main');

const phaseRunners = {
  schema: schemaPhase.run,
  facilities: facilitiesPhase.run,
  quality: qualityPhase.run,
  people: (opts) => peoplePhase.run(opts),
  enrich: enrichPhase.run,
  affiliations: affiliationsPhase.run,
};

// --- Retry wrapper ---
// Retries a phase up to maxRetries times with exponential backoff
async function runPhaseWithRetry(phaseName, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const start = Date.now();
      updateWorkerStatus(phaseName, 'running', `attempt ${attempt}`);
      log.info(`[${phaseName}] Starting (attempt ${attempt}/${maxRetries + 1})`);
      
      await phaseRunners[phaseName](options);
      
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      updateWorkerStatus(phaseName, 'completed', `${elapsed}s`);
      log.ok(`[${phaseName}] Completed in ${elapsed}s`);
      return { phase: phaseName, ok: true, elapsed };
    } catch (err) {
      const msg = err?.message || String(err);
      log.error(`[${phaseName}] Attempt ${attempt} failed: ${msg}`);
      updateWorkerStatus(phaseName, 'retrying', `attempt ${attempt} failed: ${msg}`);
      
      if (attempt <= maxRetries) {
        const backoff = Math.min(30_000, 5_000 * Math.pow(2, attempt - 1));
        log.info(`[${phaseName}] Retrying in ${backoff / 1000}s...`);
        await new Promise(r => setTimeout(r, backoff));
      } else {
        updateWorkerStatus(phaseName, 'FAILED', msg);
        log.error(`[${phaseName}] All ${maxRetries + 1} attempts failed.`);
        return { phase: phaseName, ok: false, error: msg };
      }
    }
  }
}

// --- Parallel execution ---
async function runParallel(options = {}) {
  log.info('🚀 Starting PARALLEL NPI → Twenty CRM import');
  log.info('  Worker A: quality measures (independent)');
  log.info('  Worker B: people → enrich → affiliations (sequential chain)');
  log.info('  Heartbeat: state/heartbeat.json (every 30s)\n');

  startHeartbeat();

  // Test connection first
  const test = await twenty.testConnection();
  if (!test.ok) {
    log.error(`Cannot connect to Twenty CRM: ${test.error}`);
    log.info('Check TWENTY_API_KEY and TWENTY_BASE_URL in .env');
    process.exit(1);
  }
  log.ok('Connected to Twenty CRM\n');

  // Ensure schema is done
  const progress = loadProgress();
  if (!progress.schema?.completed) {
    log.info('Running schema setup first...');
    await runPhaseWithRetry('schema', options);
  }

  // Ensure facilities are done
  if (!progress.facilities?.loadDone) {
    log.info('Running facilities import first...');
    await runPhaseWithRetry('facilities', options);
  }

  // --- Launch parallel workers ---
  const results = [];

  // Worker A: Quality (independent)
  const workerA = (async () => {
    const p = loadProgress();
    if (p.quality?.loadDone) {
      updateWorkerStatus('quality', 'skipped', 'already complete');
      log.info('[Worker A] Quality already complete — skipping');
      return { phase: 'quality', ok: true, skipped: true };
    }
    return runPhaseWithRetry('quality', options);
  })();

  // Worker B: People → Enrich → Affiliations (sequential chain)
  const workerB = (async () => {
    // Step 1: People
    const p = loadProgress();
    if (!p.people?.loadDone) {
      const result = await runPhaseWithRetry('people', options);
      if (!result.ok) return result;
    } else {
      updateWorkerStatus('people', 'skipped', 'already complete');
      log.info('[Worker B] People already complete — skipping');
    }

    // Step 2: Enrich
    const p2 = loadProgress();
    if (!p2.enrich?.done) {
      const result = await runPhaseWithRetry('enrich', options);
      if (!result.ok) return result;
    } else {
      updateWorkerStatus('enrich', 'skipped', 'already complete');
      log.info('[Worker B] Enrich already complete — skipping');
    }

    // Step 3: Affiliations
    const p3 = loadProgress();
    if (!p3.affiliations?.done) {
      return runPhaseWithRetry('affiliations', options);
    } else {
      updateWorkerStatus('affiliations', 'skipped', 'already complete');
      log.info('[Worker B] Affiliations already complete — skipping');
      return { phase: 'affiliations', ok: true, skipped: true };
    }
  })();

  // Wait for both workers
  const [resultA, resultB] = await Promise.allSettled([workerA, workerB]);

  // Report results
  console.log('\n' + '='.repeat(60));
  log.info('PARALLEL IMPORT COMPLETE — RESULTS:');
  console.log('='.repeat(60));

  const aResult = resultA.status === 'fulfilled' ? resultA.value : { phase: 'quality', ok: false, error: resultA.reason?.message };
  const bResult = resultB.status === 'fulfilled' ? resultB.value : { phase: 'worker-b', ok: false, error: resultB.reason?.message };

  console.log(`  Worker A (quality):                ${aResult.ok ? '✅ SUCCESS' : '❌ FAILED: ' + aResult.error}`);
  console.log(`  Worker B (people→enrich→affil):    ${bResult.ok ? '✅ SUCCESS' : '❌ FAILED: ' + bResult.error}`);
  console.log('='.repeat(60) + '\n');

  // Final heartbeat
  writeHeartbeat();

  if (!aResult.ok || !bResult.ok) {
    log.error('Some workers failed. Progress is saved — re-run to retry failed phases.');
    process.exit(1);
  }

  log.ok('🎉 All import phases complete! NPI data fully loaded.');
  printStatus();
}

function printStatus() {
  const p = loadProgress();
  console.log('\n📊 NPI → Twenty CRM Import Status\n');
  console.log(`  Current Phase: ${p.currentPhase}`);
  console.log(`  Last Saved:    ${p.lastSavedAt || 'never'}\n`);

  console.log('  Phase             │ Status');
  console.log('  ──────────────────┼───────────────────────────────────');
  console.log(`  Schema            │ ${p.schema.completed ? '✅ Done' : '⏳ Pending'}`);

  // Facilities breakdown
  const facSources = ['hospitals', 'healthCenters', 'nursingHomes', 'dialysis', 'homeHealth', 'hospice', 'ambulatorySurgery'];
  for (const src of facSources) {
    const s = p.facilities[src] || {};
    const label = `  ${src}`.padEnd(22);
    console.log(`  ${label}│ ${s.done ? `✅ ${(s.count || 0).toLocaleString()}` : '⏳ Pending'}`);
  }
  console.log(`  Facilities Total  │ ${p.facilities.loadDone ? '✅' : '⏳'} ${(p.facilities.createdCount || 0).toLocaleString()} created, ${(p.facilities.skippedDupes || 0).toLocaleString()} dupes`);

  // Quality breakdown
  const qSources = ['complications', 'hai', 'hcahps', 'timelyCare', 'readmissions', 'interop'];
  for (const src of qSources) {
    const s = p.quality[src] || {};
    const label = `  ${src}`.padEnd(22);
    console.log(`  ${label}│ ${s.done ? `✅ ${(s.count || 0).toLocaleString()}` : `⏳ ${(s.count || 0).toLocaleString()}`}`);
  }
  console.log(`  Quality Total     │ ${p.quality.loadDone ? '✅' : '⏳'} ${(p.quality.createdCount || 0).toLocaleString()} created`);

  console.log(`  People Extract    │ ${p.people.extractDone ? `✅ ${p.people.extractCount.toLocaleString()} records` : `⏳ ${p.people.extractCount.toLocaleString()} so far`}`);
  console.log(`  People Load       │ ${p.people.loadDone ? `✅ ${p.people.createdCount.toLocaleString()} created` : `⏳ ${p.people.createdCount.toLocaleString()} created, ${p.people.skippedDupes.toLocaleString()} dupes`}`);

  console.log(`  Enrich (NPPES)    │ ${p.enrich.done ? `✅ ${p.enrich.enrichedPeople.toLocaleString()} enriched` : `⏳ ${(p.enrich.enrichedPeople || 0).toLocaleString()} enriched / ${(p.enrich.nppesProcessed || 0).toLocaleString()} scanned`}`);

  console.log(`  Affiliations      │ ${p.affiliations.done ? `✅ ${(p.affiliations.created || 0).toLocaleString()} created` : `⏳ ${(p.affiliations.created || 0).toLocaleString()} created / ${(p.affiliations.processed || 0).toLocaleString()} processed`}`);
  console.log('');

  // Heartbeat info
  try {
    if (existsSync(HEARTBEAT_FILE)) {
      const hb = JSON.parse(readFileSync(HEARTBEAT_FILE, 'utf8'));
      console.log(`  Heartbeat: ${hb.alive ? '💚 ALIVE' : '💀 DEAD'} (${hb.timestamp})`);
      console.log(`  Memory:    ${hb.memory_mb} MB`);
      console.log(`  Uptime:    ${hb.uptime_s}s`);
      if (hb.workers) {
        for (const [name, w] of Object.entries(hb.workers)) {
          console.log(`  Worker ${name}: ${w.status} ${w.detail || ''}`);
        }
      }
      console.log('');
    }
  } catch { /* ignore */ }

  // State files
  const files = ['raw_people', 'facility_map', 'person_map'];
  console.log('  Data Files:');
  for (const f of files) {
    const count = ndjsonLineCount(f);
    if (count > 0) console.log(`    ${f}.ndjson: ${count.toLocaleString()} lines`);
  }
  console.log('');
}

async function runPhase(phaseName, options = {}) {
  const runner = phaseRunners[phaseName];
  if (!runner) {
    log.error(`Unknown phase: ${phaseName}. Valid: ${PHASES.join(', ')}`);
    process.exit(1);
  }

  log.info(`Running phase: ${phaseName}`);
  const start = Date.now();

  try {
    await runner(options);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.ok(`Phase "${phaseName}" completed in ${elapsed}s`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.error(`Phase "${phaseName}" failed after ${elapsed}s: ${err.message}`);
    log.info('Progress has been saved. Re-run to resume from where you left off.');
    process.exit(1);
  }
}

// --- CLI ---

const args = process.argv.slice(2);

// Parse options
const options = {};
const limitIdx = args.indexOf('--limit');
if (limitIdx !== -1 && args[limitIdx + 1]) {
  options.limit = parseInt(args[limitIdx + 1], 10);
}
if (args.includes('--dry-run')) {
  options.dryRun = true;
}

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
      writeHeartbeat();
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
    log.error('Specify a phase: --phase schema|facilities|quality|people|enrich|affiliations');
    process.exit(1);
  }
  startHeartbeat();
  await runPhase(phaseName, options);
} else {
  // Default: parallel execution
  await runParallel(options);
}
