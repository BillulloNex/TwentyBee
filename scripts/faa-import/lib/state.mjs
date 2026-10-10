// Persistent state management for resumable imports.
// Uses a JSON progress file + append-only NDJSON for large mappings.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, createReadStream, unlinkSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { STATE_DIR } from '../config.mjs';

mkdirSync(STATE_DIR, { recursive: true });

const PROGRESS_FILE = resolve(STATE_DIR, 'progress.json');

// --- Progress (small JSON file, overwritten on save) ---

const DEFAULT_PROGRESS = {
  currentPhase: 'schema',
  schema: { completed: false },
  companies: {
    extractDone: false,
    extractCursor: null,
    extractCount: 0,
    loadDone: false,
    loadOffset: 0,
    createdCount: 0,
    skippedDupes: 0,
  },
  people: {
    extractDone: false,
    extractCursor: null,
    extractCount: 0,
    loadDone: false,
    loadOffset: 0,
    createdCount: 0,
    skippedDupes: 0,
  },
  prices: {
    extractDone: false,
    extractCursor: null,
    extractCount: 0,
  },
  aircraft: {
    loadDone: false,
    loadOffset: 0,
    createdCount: 0,
  },
  lastSavedAt: null,
};

let _progress = null;

export function loadProgress() {
  if (_progress) return _progress;
  try {
    _progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    _progress = structuredClone(DEFAULT_PROGRESS);
  }
  return _progress;
}

export function saveProgress() {
  _progress.lastSavedAt = new Date().toISOString();
  writeFileSync(PROGRESS_FILE, JSON.stringify(_progress, null, 2));
}

export function resetProgress() {
  _progress = structuredClone(DEFAULT_PROGRESS);
  saveProgress();
  // Clean up data files
  const files = readdirSync(STATE_DIR);
  for (const f of files) {
    if (f.endsWith('.ndjson') || f.endsWith('.json.bak')) {
      unlinkSync(resolve(STATE_DIR, f));
    }
  }
}

// --- NDJSON files (append-only for large data) ---

export function ndjsonPath(name) {
  return resolve(STATE_DIR, `${name}.ndjson`);
}

export function appendNdjson(name, record) {
  appendFileSync(ndjsonPath(name), JSON.stringify(record) + '\n');
}

export function appendNdjsonBatch(name, records) {
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  appendFileSync(ndjsonPath(name), lines);
}

// Stream-read NDJSON file line by line, calling fn(record, lineIndex) for each.
// If startOffset > 0, skip that many lines before calling fn.
export async function streamNdjson(name, fn, startOffset = 0) {
  const filePath = ndjsonPath(name);
  if (!existsSync(filePath)) return 0;

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let lineIdx = 0;
  for await (const line of rl) {
    if (lineIdx >= startOffset && line.trim()) {
      const record = JSON.parse(line);
      const shouldStop = await fn(record, lineIdx);
      if (shouldStop === true) {
        rl.close();
        return lineIdx + 1;
      }
    }
    lineIdx++;
  }
  return lineIdx;
}

// Load full NDJSON into a Map (for ID mappings). Key extractor returns the map key.
export async function loadNdjsonMap(name, keyExtractor) {
  const map = new Map();
  const filePath = ndjsonPath(name);
  if (!existsSync(filePath)) return map;

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim()) {
      const record = JSON.parse(line);
      map.set(keyExtractor(record), record);
    }
  }
  return map;
}

// Load full NDJSON into a Set (for dedup keys).
export async function loadNdjsonSet(name, keyExtractor) {
  const set = new Set();
  const filePath = ndjsonPath(name);
  if (!existsSync(filePath)) return set;

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim()) {
      const record = JSON.parse(line);
      set.add(keyExtractor(record));
    }
  }
  return set;
}

export function ndjsonLineCount(name) {
  const filePath = ndjsonPath(name);
  if (!existsSync(filePath)) return 0;
  const content = readFileSync(filePath, 'utf8');
  return content.split('\n').filter((l) => l.trim()).length;
}
