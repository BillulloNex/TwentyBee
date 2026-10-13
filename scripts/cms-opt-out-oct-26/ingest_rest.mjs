#!/usr/bin/env node
/**
 * Bulk ingest FL opt-out providers via Twenty REST API.
 * Uses the /api/objects/optOutProvider endpoint (kebab-case URL).
 * Runs 5 concurrent workers for speed.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

function loadEnv() {
  const envPaths = [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../.env')];
  for (const p of envPaths) {
    try {
      const content = fs.readFileSync(p, 'utf8');
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

const TOKEN = process.env.TWENTY_API_KEY;
const BATCHES_DIR = path.resolve(__dirname, 'twenty_batches');
const START_BATCH = 2;
const END_BATCH = 112;
const CONCURRENCY = 3;

if (!TOKEN) {
  console.error("❌ Missing TWENTY_API_KEY in environment or .env");
  process.exit(1);
}

let created = 0;
let failed = 0;
let batchesDone = 0;

function postBatch(records) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(records);
    const options = {
      hostname: '20.beenex.cloud',
      port: 443,
      path: '/api/objects/optOutProviders',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data.slice(0, 300) });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function processOneBatch(batchIdx) {
  const filePath = path.join(BATCHES_DIR, `batch_${String(batchIdx).padStart(3, '0')}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const records = data.records;

  // Create one at a time via REST (POST single record)
  let batchCreated = 0;
  for (const record of records) {
    try {
      const result = await postBatch(record);
      if (result.status === 201 || result.status === 200) {
        batchCreated++;
        created++;
      } else {
        failed++;
        if (failed <= 3) {
          console.error(`  ❌ Failed (HTTP ${result.status}): ${JSON.stringify(result.data).slice(0, 200)}`);
        }
      }
    } catch (e) {
      failed++;
    }
  }

  batchesDone++;
  if (batchesDone % 10 === 0 || batchesDone === END_BATCH - START_BATCH + 1) {
    console.log(`  [${batchesDone}/${END_BATCH - START_BATCH + 1}] created: ${created}, failed: ${failed}`);
  }

  return batchCreated;
}

async function main() {
  console.log(`Testing API connectivity...`);
  
  // Test with a single GET
  const testResult = await postBatch({
    npi: 'TEST_DELETE',
    firstName: 'Test',
    lastName: 'Delete',
    name: 'Test Delete',
    specialty: 'Test',
    city: 'Test',
    zipCode: '00000',
    streetAddress: 'Test',
    eligibleToOrderRefer: false,
    position: 'last'
  });
  console.log(`Test result: HTTP ${testResult.status}`);
  console.log(`Response: ${JSON.stringify(testResult.data).slice(0, 300)}`);
}

main().catch(console.error);
