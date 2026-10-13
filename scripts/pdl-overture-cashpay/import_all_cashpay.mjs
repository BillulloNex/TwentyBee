#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPaths = [resolve(__dirname, '.env'), resolve(__dirname, '../.env')];
  for (const p of envPaths) {
    try {
      const content = readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[k]) process.env[k] = v;
        }
      }
      break;
    } catch {}
  }
}
loadEnv();

const API_KEY = process.env.TWENTY_API_KEY;
const BASE_URL = process.env.TWENTY_BASE_URL || 'https://20.beenex.cloud';
if (!API_KEY) {
  console.error("❌ Missing TWENTY_API_KEY in environment or .env");
  process.exit(1);
}

const OVERTURE_CSV = resolve(__dirname, 'overture_cashpay_medical_practices.csv');
const PDL_CSV = resolve(__dirname, 'pdl_cashpay_medical_practices.csv');

const BATCH_SIZE = 50;
const RATE_INTERVAL_MS = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendBatch(endpoint, records) {
  const res = await fetch(`${BASE_URL}/rest/batch/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(records),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function importOverture() {
  console.log('\n========================================');
  console.log('  IMPORTING OVERTURE CASH-PAY PRACTICES');
  console.log('========================================');
  
  const content = readFileSync(OVERTURE_CSV, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true });
  console.log(`Loaded ${records.length} records from CSV.`);

  let imported = 0;
  let batch = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    batch.push({
      name: (row.name || 'Unknown Practice').slice(0, 255),
      overtureId: row.overture_id || '',
      cashPaySignalType: row.cashpay_signal_type || '',
      matchedKeyword: row.matched_keyword || '',
      category: row.category || '',
      streetAddress: row.address || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.zip || '',
      phone: row.phone || '',
      website: row.website || '',
      position: 'first'
    });

    if (batch.length >= BATCH_SIZE || i === records.length - 1) {
      try {
        await sendBatch('overtureCashPayPractices', batch);
        imported += batch.length;
        process.stdout.write(`\rImported ${imported} / ${records.length} Overture practices...`);
      } catch (err) {
        console.error(`\nBatch error at index ${i}:`, err.message);
      }
      batch = [];
      await sleep(RATE_INTERVAL_MS);
    }
  }
  console.log(`\n✅ Finished Overture import: ${imported} records created.`);
}

async function importPDL() {
  console.log('\n========================================');
  console.log('  IMPORTING PDL CASH-PAY COMPANIES');
  console.log('========================================');

  const content = readFileSync(PDL_CSV, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true });
  console.log(`Loaded ${records.length} records from CSV.`);

  let imported = 0;
  let batch = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    batch.push({
      name: (row.name || 'Unknown Company').slice(0, 255),
      pdlId: row.pdl_id || '',
      cashPaySignalType: row.cashpay_signal_type || '',
      matchedKeyword: row.matched_keyword || '',
      industry: row.industry || '',
      companySize: row.size || '',
      foundedYear: row.founded ? String(row.founded) : '',
      locality: row.locality || '',
      region: row.region || '',
      website: row.website || '',
      linkedinUrl: row.linkedin_url || '',
      position: 'first'
    });

    if (batch.length >= BATCH_SIZE || i === records.length - 1) {
      try {
        await sendBatch('pdlCashPayCompanies', batch);
        imported += batch.length;
        process.stdout.write(`\rImported ${imported} / ${records.length} PDL companies...`);
      } catch (err) {
        console.error(`\nBatch error at index ${i}:`, err.message);
      }
      batch = [];
      await sleep(RATE_INTERVAL_MS);
    }
  }
  console.log(`\n✅ Finished PDL import: ${imported} records created.`);
}

async function main() {
  const start = Date.now();
  await importOverture();
  await importPDL();
  const durSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n🎉 All done in ${durSec}s!`);
}

main().catch(console.error);
