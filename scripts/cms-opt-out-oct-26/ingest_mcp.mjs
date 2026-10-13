import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

if (!TOKEN) {
  console.error("❌ Missing TWENTY_API_KEY in environment or .env");
  process.exit(1);
}

let created = 0, failed = 0, batchesDone = 0;

function mcpCall(toolName, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    });

    const options = {
      hostname: '20.beenex.cloud',
      port: 443,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: data.slice(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function processBatch(idx) {
  const filePath = path.join(BATCHES_DIR, `batch_${String(idx).padStart(3, '0')}.json`);
  const batch = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  try {
    const result = await mcpCall('execute_tool', {
      toolName: 'upsert_many_opt_out_providers',
      arguments: { records: batch.records }
    });

    batchesDone++;
    if (result.status === 200) {
      const content = result.data?.result?.[0]?.content?.[0]?.text || JSON.stringify(result.data);
      const match = content.match(/created:\s*(\d+)/);
      const numCreated = match ? parseInt(match[1]) : batch.records.length;
      created += numCreated;
    } else {
      failed += batch.records.length;
      if (failed <= 60) console.error(`  ❌ Batch ${idx}: HTTP ${result.status} - ${JSON.stringify(result.data).slice(0,200)}`);
    }

    if (batchesDone % 10 === 0 || idx === END_BATCH) {
      console.log(`  [${batchesDone}/${END_BATCH - START_BATCH + 1}] created: ${created}, failed: ${failed}`);
    }
  } catch (e) {
    failed += batch.records.length;
    console.error(`  ❌ Batch ${idx} error: ${e.message}`);
  }
}

async function main() {
  const totalBatches = END_BATCH - START_BATCH + 1;
  console.log(`Ingesting ${totalBatches} batches (${totalBatches * 20} records) via MCP...`);

  // Test with batch 2 first
  console.log('Testing with batch 2...');
  await processBatch(2);
  console.log(`Test result: created=${created}, failed=${failed}`);

  if (failed > 0) {
    console.log('Test failed — trying different MCP endpoint format...');
    
    // Try SSE/streaming MCP format
    const filePath = path.join(BATCHES_DIR, 'batch_002.json');
    const batch = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Try direct execute_tool format
    const body2 = JSON.stringify({
      toolName: 'upsert_many_opt_out_providers',
      arguments: { records: batch.records }
    });
    
    const result2 = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: '20.beenex.cloud',
        port: 443,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Length': Buffer.byteLength(body2)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: data.slice(0, 500) }));
      });
      req.on('error', reject);
      req.write(body2);
      req.end();
    });
    
    console.log(`Direct test: HTTP ${result2.status}`);
    console.log(`Response: ${result2.data}`);
    return;
  }

  // Process remaining batches (3-112) with concurrency of 5
  const CONCURRENCY = 5;
  const remaining = Array.from({length: END_BATCH - 2}, (_, i) => i + 3);
  
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const chunk = remaining.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(idx => processBatch(idx)));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`DONE!`);
  console.log(`Created: ${created}`);
  console.log(`Failed:  ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(console.error);
