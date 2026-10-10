// Twenty CRM REST API client — batch creates, metadata operations, rate limiting.

import { TWENTY_API_KEY, TWENTY_BASE_URL, TWENTY_BATCH_SIZE, TWENTY_RATE_INTERVAL_MS } from '../config.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, path, body = null, { isMetadata = false } = {}) {
  const base = isMetadata ? `${TWENTY_BASE_URL}/rest/metadata` : `${TWENTY_BASE_URL}/rest`;
  const url = `${base}${path}`;

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${TWENTY_API_KEY}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) opts.body = JSON.stringify(body);

  let retries = 0;
  while (true) {
    const res = await fetch(url, opts);

    if (res.status === 429) {
      retries++;
      const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
      const waitMs = Math.max(retryAfter * 1000, 5000);
      if (retries > 10) throw new Error(`Rate limited after ${retries} retries on ${method} ${path}`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      if (retries < 3 && res.status >= 500) {
        retries++;
        await sleep(2000 * retries);
        continue;
      }
      throw new Error(`Twenty API ${res.status} on ${method} ${path}: ${text}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }
    return res.text();
  }
}

// --- Connection test ---

export async function testConnection() {
  try {
    const result = await request('GET', '/companies?limit=1');
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// --- Core data operations ---

export async function createOne(objectName, data) {
  return request('POST', `/${objectName}`, data);
}

export async function createBatch(objectName, records) {
  return request('POST', `/batch/${objectName}`, records, { isMetadata: false });
}

// Batch create with rate limiting. Splits records into chunks of TWENTY_BATCH_SIZE.
// Calls onBatch(createdRecords, batchIndex) after each successful batch.
export async function batchCreate(objectName, records, { onBatch, log, startOffset = 0 }) {
  let created = 0;
  let batchIdx = 0;

  for (let i = 0; i < records.length; i += TWENTY_BATCH_SIZE) {
    if (i < startOffset) {
      batchIdx++;
      continue;
    }

    const chunk = records.slice(i, i + TWENTY_BATCH_SIZE);

    let result;
    let retries = 0;
    while (true) {
      try {
        result = await request('POST', `/batch/${objectName}`, chunk);
        break;
      } catch (err) {
        retries++;
        if (retries > 3) {
          if (log) log.error(`Batch ${batchIdx} failed after ${retries} retries: ${err.message}`);
          throw err;
        }
        if (log) log.warn(`Batch ${batchIdx} error (attempt ${retries}/3): ${err.message}`);
        await sleep(3000 * retries);
      }
    }

    const createdRecords = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : [result]);
    created += createdRecords.length;

    if (onBatch) await onBatch(createdRecords, batchIdx, i + chunk.length);

    batchIdx++;

    // Rate limit
    await sleep(TWENTY_RATE_INTERVAL_MS);
  }

  return created;
}

// Stream-based batch create: reads from a generator, groups into batches, sends.
export async function streamBatchCreate(objectName, generator, { onBatch, log }) {
  let batch = [];
  let batchIdx = 0;
  let totalCreated = 0;

  for await (const record of generator) {
    batch.push(record);

    if (batch.length >= TWENTY_BATCH_SIZE) {
      let result;
      let retries = 0;
      while (true) {
        try {
          result = await request('POST', `/batch/${objectName}`, batch);
          break;
        } catch (err) {
          retries++;
          if (retries > 3) {
            if (log) log.error(`Batch ${batchIdx} failed: ${err.message}`);
            throw err;
          }
          if (log) log.warn(`Batch ${batchIdx} retry ${retries}/3: ${err.message}`);
          await sleep(3000 * retries);
        }
      }

      const createdRecords = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : [result]);
      totalCreated += createdRecords.length;

      if (onBatch) await onBatch(createdRecords, batchIdx);

      batch = [];
      batchIdx++;
      await sleep(TWENTY_RATE_INTERVAL_MS);
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    let result;
    try {
      result = await request('POST', `/batch/${objectName}`, batch);
    } catch (err) {
      if (log) log.error(`Final batch failed: ${err.message}`);
      throw err;
    }
    const createdRecords = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : [result]);
    totalCreated += createdRecords.length;
    if (onBatch) await onBatch(createdRecords, batchIdx);
  }

  return totalCreated;
}

// --- Metadata operations ---

export async function listObjects() {
  return request('GET', '/objects?pageSize=100', null, { isMetadata: true });
}

export async function createObject(definition) {
  return request('POST', '/objects', definition, { isMetadata: true });
}

export async function listFields(objectId) {
  return request('GET', `/fields?filter=objectMetadataId[eq]=${objectId}&pageSize=200`, null, { isMetadata: true });
}

export async function createField(definition) {
  return request('POST', '/fields', definition, { isMetadata: true });
}

export async function createRelation(definition) {
  return request('POST', '/relations', definition, { isMetadata: true });
}

// --- Helpers ---

export async function getObjectByName(nameSingular) {
  const result = await listObjects();
  const objects = result?.data?.objects || result?.data || result?.objects || [];
  return objects.find((o) => o.nameSingular === nameSingular);
}
