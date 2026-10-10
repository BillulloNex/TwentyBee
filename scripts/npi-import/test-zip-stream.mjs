import { spawn } from 'node:child_process';
import { parse } from 'csv-parse';
import { DATA_FILES } from './config.mjs';

const zipPath = DATA_FILES.nppesZip;
const innerFile = DATA_FILES.nppesMainFile;

console.log('Starting unzip stream test...');
console.log(`  ZIP: ${zipPath}`);
console.log(`  CSV: ${innerFile}`);

const unzip = spawn('unzip', ['-p', zipPath, innerFile], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
unzip.stderr.on('data', () => {});

const parser = unzip.stdout.pipe(parse({
  columns: true,
  skip_empty_lines: true,
  relax_column_count: true,
  trim: true,
}));

console.log('Parser created, attempting for-await...');

let count = 0;
const start = Date.now();

try {
  for await (const record of parser) {
    count++;
    if (count <= 3) {
      console.log(`Row ${count}: NPI=${record['NPI']}, Entity=${record['Entity Type Code']}`);
    }
    if (count % 10000 === 0) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ${count.toLocaleString()} rows in ${elapsed}s`);
    }
    if (count >= 50000) {
      console.log('Test passed — 50K rows read successfully');
      unzip.kill();
      break;
    }
  }
} catch (err) {
  console.error('ERROR:', err.message);
}

console.log(`Total: ${count} rows`);
process.exit(0);
