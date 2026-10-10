// Phase 5: Enrich People with NPPES data — address, taxonomy codes, license info.
// Streams the 11 GB extracted NPPES CSV, cross-references with imported people
// by NPI, and patches missing fields + adds taxonomy/license data.
// Serial PATCHes at 650ms intervals to stay under 100 req/60s API limit.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress, loadNdjsonMap } from '../lib/state.mjs';
import { streamCsv } from '../lib/csv-reader.mjs';
import { resolve, dirname } from 'node:path';
import { DATA_FILES, TWENTY_BASE_URL, TWENTY_API_KEY } from '../config.mjs';

const log = createLogger('enrich');

const PATCH_INTERVAL_MS = 650; // 92 req/min — safely under 100/60s API limit

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function titleCase(str) {
  if (!str) return '';
  return str.toLowerCase().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatPhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

function formatZip(raw) {
  if (!raw) return '';
  const zip = raw.replace(/\D/g, '');
  if (zip.length >= 5) return zip.slice(0, 5);
  return zip.padStart(5, '0');
}

// Patch a person with retry on 429/5xx/network errors
async function patchPerson(twentyId, updates) {
  const url = `${TWENTY_BASE_URL}/rest/people/${twentyId}`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TWENTY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
        const waitMs = Math.max(retryAfter * 1000, 5000 * attempt);
        if (attempt < 5) { await sleep(waitMs); continue; }
        throw new Error(`Rate limited after ${attempt} retries`);
      }

      if (res.status >= 500 && attempt < 5) {
        await sleep(3000 * attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`${res.status}: ${text.slice(0, 200)}`);
      }
      return true;
    } catch (err) {
      if (attempt < 5 && (err.cause?.code === 'ECONNRESET' || err.message?.includes('fetch failed'))) {
        await sleep(3000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

function buildUpdates(record) {
  const updates = {};

  const practiceAddress = record['Provider First Line Business Practice Location Address'];
  const practiceCity = record['Provider Business Practice Location Address City Name'];
  const practiceState = record['Provider Business Practice Location Address State Name'];
  const practiceZip = record['Provider Business Practice Location Address Postal Code'];
  const practicePhone = record['Provider Business Practice Location Address Telephone Number'];

  if (practiceAddress && practiceCity) {
    updates.addressStreet = titleCase(practiceAddress);
    const addr2 = record['Provider Second Line Business Practice Location Address'];
    if (addr2) updates.addressStreet2 = titleCase(addr2);
    updates.addressCity = titleCase(practiceCity);
    updates.addressState = (practiceState || '').toUpperCase();
    updates.addressZip = formatZip(practiceZip);
  }
  if (practicePhone) {
    updates.phoneNumber = formatPhone(practicePhone);
  }

  const taxonomy1 = record['Healthcare Provider Taxonomy Code_1'];
  if (taxonomy1) {
    updates.taxonomyCode = taxonomy1;
    const taxDesc = record['Healthcare Provider Primary Taxonomy Switch_1'];
    if (taxDesc === 'Y') {
      updates.taxonomyDescription = `Primary: ${taxonomy1}`;
    }
  }

  const licNum = record['Provider License Number_1'];
  const licState = record['Provider License Number State Code_1'];
  if (licNum) {
    updates.licenseNumber = licNum;
    updates.licenseState = (licState || '').toUpperCase();
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

export async function run() {
  const progress = loadProgress();

  if (progress.enrich.done) {
    log.info('Enrichment already done, skipping');
    return;
  }

  log.info('Loading person NPI→Twenty ID mapping...');
  const personMap = await loadNdjsonMap('person_map', (r) => r.npi);
  log.info(`Loaded ${personMap.size.toLocaleString()} person NPI mappings`);

  if (personMap.size === 0) {
    log.warn('No person mappings found — skipping enrichment.');
    return;
  }

  const nppesExtractedPath = resolve(dirname(DATA_FILES.nppesZip), DATA_FILES.nppesMainFile);
  log.info('Streaming extracted NPPES CSV for enrichment...');
  log.info(`  CSV: ${nppesExtractedPath}`);
  log.info(`  Pace: 1 PATCH every ${PATCH_INTERVAL_MS}ms (~${Math.floor(60000 / PATCH_INTERVAL_MS)} req/min)`);

  let matched = 0;
  let enriched = 0;
  let processed = 0;
  let errors = 0;
  let lastPatchTime = 0;

  try {
    await streamCsv(
      nppesExtractedPath,
      async (record) => {
        processed++;

        if (processed === 1) {
          log.info(`  First record: NPI=${record['NPI']}, Entity=${record['Entity Type Code']}`);
        }

        if (processed % 10000 === 0) {
          progress.enrich.nppesProcessed = processed;
          progress.enrich.enrichedPeople = enriched;
          saveProgress();
          const rate = enriched > 0 ? (enriched / ((Date.now() - lastPatchTime) / 60000 + 0.001)).toFixed(0) : '?';
          log.progress(processed, 8000000, `enriched: ${enriched.toLocaleString()}, errors: ${errors}, ~${rate}/min`);
        }

        if (record['Entity Type Code'] !== '1') return;

        const npi = record['NPI'];
        const person = personMap.get(npi);
        if (!person?.twentyId) return;

        const updates = buildUpdates(record);
        if (!updates) return;

        matched++;
        if (matched === 1) {
          log.info(`  First match: NPI=${npi}, twentyId=${person.twentyId}`);
          lastPatchTime = Date.now();
        }

        // Throttle: ensure PATCH_INTERVAL_MS between requests
        const elapsed = Date.now() - lastPatchTime;
        if (elapsed < PATCH_INTERVAL_MS) {
          await sleep(PATCH_INTERVAL_MS - elapsed);
        }

        try {
          await patchPerson(person.twentyId, updates);
          enriched++;
        } catch (err) {
          errors++;
          if (errors <= 5 || errors % 1000 === 0) {
            log.warn(`  Patch failed NPI ${npi}: ${err.message.slice(0, 150)}`);
          }
        }

        lastPatchTime = Date.now();
      },
      { startOffset: progress.enrich.nppesProcessed || 0 }
    );
  } catch (err) {
    log.error(`NPPES stream error: ${err.message}`);
    progress.enrich.nppesProcessed = processed;
    progress.enrich.enrichedPeople = enriched;
    saveProgress();
    throw err;
  }

  log.progressDone();
  progress.enrich.done = true;
  progress.enrich.nppesProcessed = processed;
  progress.enrich.enrichedPeople = enriched;
  progress.currentPhase = 'affiliations';
  saveProgress();

  log.ok(`Enrichment complete — ${matched.toLocaleString()} matched, ${enriched.toLocaleString()} enriched, ${errors.toLocaleString()} errors out of ${processed.toLocaleString()} NPPES records`);
}
