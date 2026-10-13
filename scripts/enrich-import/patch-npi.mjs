#!/usr/bin/env node

// Patch extractedNpi onto the 50 enrich-import people who have it.
//
// Safety:
//   1. Default mode is --dry-run (prints what would happen, touches nothing)
//   2. In live mode, reads the current record BEFORE patching to verify identity
//   3. Will NOT overwrite an existing NPI value (skip + log)
//   4. Writes a full audit ledger to patch_npi_ledger.json
//
// Usage:
//   node patch-npi.mjs              # dry-run (default)
//   node patch-npi.mjs --execute    # live run

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────
const envContent = readFileSync(resolve(__dirname, '.env'), 'utf8');
let apiKey = '';
let baseUrl = 'https://20.beenex.cloud';
for (const line of envContent.split('\n')) {
  if (line.startsWith('TWENTY_API_KEY=')) apiKey = line.slice('TWENTY_API_KEY='.length).trim();
  if (line.startsWith('TWENTY_BASE_URL=')) baseUrl = line.slice('TWENTY_BASE_URL='.length).trim();
}

const isLive = process.argv.includes('--execute');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Load source data ────────────────────────────────────────
const report = JSON.parse(readFileSync(resolve(__dirname, 'dry_run_report.json'), 'utf8'));
const ledger = JSON.parse(readFileSync(resolve(__dirname, 'execution_ledger.json'), 'utf8'));

// Build the patch list: { twentyId, npi, name, source }
const patchList = [];

// 1. Updates — already have twentyId
for (const u of report.allUpdates) {
  const npi = u.row?.extractedNpi;
  if (!npi || !u.twentyId) continue;
  patchList.push({
    twentyId: u.twentyId,
    npi,
    name: u.row.fullName,
    source: 'update',
  });
}

// 2. Creates — match by name from execution ledger
const createLedgerByName = new Map();
for (const c of ledger.createLedger) {
  createLedgerByName.set(c.name.trim().toLowerCase(), c.id);
}

for (const c of report.allCreates) {
  const npi = c.row?.extractedNpi;
  if (!npi) continue;
  const nameKey = c.row.fullName.trim().toLowerCase();
  const twentyId = createLedgerByName.get(nameKey);
  if (!twentyId) {
    console.warn(`⚠️  Cannot find Twenty ID for created person: ${c.row.fullName} (NPI ${npi}) — SKIPPING`);
    continue;
  }
  patchList.push({
    twentyId,
    npi,
    name: c.row.fullName,
    source: 'create',
  });
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  NPI PATCH — ${isLive ? '🔴 LIVE MODE' : '🟢 DRY RUN (use --execute to apply)'}`);
console.log(`  Total candidates: ${patchList.length}`);
console.log(`${'='.repeat(60)}\n`);

// ── API helpers ─────────────────────────────────────────────

async function fetchPerson(twentyId) {
  const res = await fetch(`${baseUrl}/rest/people/${twentyId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /people/${twentyId}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function patchPerson(twentyId, data) {
  const res = await fetch(`${baseUrl}/rest/people/${twentyId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH /people/${twentyId}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Main ────────────────────────────────────────────────────

const auditLog = [];
let patched = 0;
let skippedHasNpi = 0;
let skippedNotFound = 0;
let errors = 0;

for (let i = 0; i < patchList.length; i++) {
  const item = patchList[i];
  const tag = `[${i + 1}/${patchList.length}]`;

  try {
    // Pre-flight: read current record to verify identity & check existing NPI
    const current = await fetchPerson(item.twentyId);
    const currentName = `${current?.name?.firstName || ''} ${current?.name?.lastName || ''}`.trim();
    const currentNpi = current?.npi || '';

    // Safety check: don't overwrite existing NPI
    if (currentNpi && currentNpi.trim() !== '') {
      console.log(`${tag} SKIP (already has NPI=${currentNpi}): ${item.name}`);
      auditLog.push({ ...item, action: 'SKIPPED_HAS_NPI', currentNpi, currentName });
      skippedHasNpi++;
      continue;
    }

    // Safety check: verify the name roughly matches
    const nameMatch =
      currentName.toLowerCase().includes(item.name.split(' ')[0].toLowerCase()) ||
      item.name.toLowerCase().includes(currentName.split(' ')[0].toLowerCase());

    if (!nameMatch) {
      console.warn(`${tag} ⚠️  NAME MISMATCH — expected "${item.name}", found "${currentName}" — SKIPPING`);
      auditLog.push({ ...item, action: 'SKIPPED_NAME_MISMATCH', currentName });
      errors++;
      continue;
    }

    if (isLive) {
      await patchPerson(item.twentyId, { npi: item.npi });
      console.log(`${tag} ✅ PATCHED: ${item.name} → NPI ${item.npi}`);
      auditLog.push({ ...item, action: 'PATCHED', currentName });
      patched++;
    } else {
      console.log(`${tag} 🔍 WOULD PATCH: ${item.name} (${currentName}) → NPI ${item.npi}`);
      auditLog.push({ ...item, action: 'DRY_RUN', currentName });
      patched++;
    }

    await sleep(100); // gentle rate limit
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('not found')) {
      console.warn(`${tag} ⚠️  NOT FOUND: ${item.name} (${item.twentyId}) — SKIPPING`);
      auditLog.push({ ...item, action: 'SKIPPED_NOT_FOUND', error: err.message });
      skippedNotFound++;
    } else {
      console.error(`${tag} ❌ ERROR: ${item.name}: ${err.message}`);
      auditLog.push({ ...item, action: 'ERROR', error: err.message });
      errors++;
    }
  }
}

// ── Summary & Audit ─────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`  RESULTS (${isLive ? 'LIVE' : 'DRY RUN'})`);
console.log(`${'='.repeat(60)}`);
console.log(`  ${isLive ? 'Patched' : 'Would patch'}:  ${patched}`);
console.log(`  Skipped (has NPI):   ${skippedHasNpi}`);
console.log(`  Skipped (not found): ${skippedNotFound}`);
console.log(`  Errors:              ${errors}`);
console.log(`${'='.repeat(60)}\n`);

const ledgerPath = resolve(__dirname, 'patch_npi_ledger.json');
writeFileSync(ledgerPath, JSON.stringify({
  mode: isLive ? 'LIVE' : 'DRY_RUN',
  timestamp: new Date().toISOString(),
  summary: { total: patchList.length, patched, skippedHasNpi, skippedNotFound, errors },
  entries: auditLog,
}, null, 2));

console.log(`Audit ledger: ${ledgerPath}`);
