import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'fs';
import path from 'path';
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
const BASE_URL = process.env.TWENTY_BASE_URL || 'https://20.beenex.cloud';
const MCP_URL = `${BASE_URL}/mcp`;
const BATCHES_DIR = path.resolve(__dirname, 'twenty_batches');
const START_BATCH = 3; // 0-2 already done
const END_BATCH = 112;

if (!TOKEN) {
  console.error("❌ Missing TWENTY_API_KEY in environment or .env");
  process.exit(1);
}

async function main() {
  console.log('Connecting to Twenty MCP...');
  
  const client = new Client({ name: 'bulk-ingest', version: '1.0.0' });

  // Try StreamableHTTP first, fall back to SSE
  let transport;
  try {
    transport = new StreamableHTTPClientTransport(
      new URL(MCP_URL),
      { requestInit: { headers: { 'Authorization': `Bearer ${TOKEN}` } } }
    );
    await client.connect(transport);
    console.log('Connected via StreamableHTTP');
  } catch (e) {
    console.log(`StreamableHTTP failed: ${e.message}, trying SSE...`);
    transport = new SSEClientTransport(
      new URL(MCP_URL),
      { requestInit: { headers: { 'Authorization': `Bearer ${TOKEN}` } } }
    );
    await client.connect(transport);
    console.log('Connected via SSE');
  }

  let created = 0, updated = 0, failed = 0;
  const totalBatches = END_BATCH - START_BATCH + 1;
  
  console.log(`Processing ${totalBatches} batches (${totalBatches * 20} records)...`);
  
  for (let i = START_BATCH; i <= END_BATCH; i++) {
    const filePath = path.join(BATCHES_DIR, `batch_${String(i).padStart(3, '0')}.json`);
    const batch = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    try {
      const result = await client.callTool({
        name: 'execute_tool',
        arguments: {
          toolName: 'upsert_many_opt_out_providers',
          arguments: { records: batch.records }
        }
      });
      
      // Parse result
      const text = result?.content?.[0]?.text || '';
      const parsed = JSON.parse(text);
      
      if (parsed.success) {
        created += parsed.result?.created || 0;
        updated += parsed.result?.updated || 0;
      } else {
        failed += batch.records.length;
        console.error(`  ❌ Batch ${i}: ${parsed.message || parsed.error}`);
      }
    } catch (e) {
      failed += batch.records.length;
      console.error(`  ❌ Batch ${i}: ${e.message}`);
    }
    
    const done = i - START_BATCH + 1;
    if (done % 10 === 0 || i === END_BATCH) {
      console.log(`  [${done}/${totalBatches}] created: ${created}, updated: ${updated}, failed: ${failed}`);
    }
  }
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`DONE!`);
  console.log(`Created:  ${created}`);
  console.log(`Updated:  ${updated}`);
  console.log(`Failed:   ${failed}`);
  console.log(`${'='.repeat(50)}`);
  
  await client.close();
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
