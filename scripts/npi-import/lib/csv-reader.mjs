// Streaming CSV reader — wraps csv-parse for memory-efficient processing of large files.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parse } from 'csv-parse';

// Stream a CSV file, calling fn(record, index) for each row.
// record is an object keyed by header names.
// Returns total rows processed.
export async function streamCsv(filePath, fn, { startOffset = 0, limit = Infinity, encoding = 'utf-8' } = {}) {
  const parser = createReadStream(filePath, { encoding })
    .pipe(parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }));

  let idx = 0;
  let processed = 0;

  for await (const record of parser) {
    if (idx < startOffset) {
      idx++;
      continue;
    }
    if (processed >= limit) break;

    const shouldStop = await fn(record, idx);
    if (shouldStop === true) break;

    idx++;
    processed++;
  }

  return processed;
}

export async function streamCsvFromZip(zipPath, innerFile, fn, { startOffset = 0, limit = Infinity } = {}) {
  const { spawn } = await import('node:child_process');

  const unzip = spawn('unzip', ['-p', zipPath, innerFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Suppress unzip warnings
  unzip.stderr.on('data', () => {});

  const parser = unzip.stdout.pipe(parse({
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }));

  let idx = 0;
  let processed = 0;

  try {
    for await (const record of parser) {
      if (idx < startOffset) {
        idx++;
        continue;
      }
      if (processed >= limit) {
        unzip.kill();
        break;
      }

      const shouldStop = await fn(record, idx);
      if (shouldStop === true) {
        unzip.kill();
        break;
      }

      idx++;
      processed++;
    }
  } catch (err) {
    unzip.kill();
    throw err;
  }

  return processed;
}

// Count rows in a CSV file (streaming, memory-safe)
export async function countCsvRows(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let count = -1; // Subtract header
  for await (const _line of rl) {
    count++;
  }
  return Math.max(0, count);
}
