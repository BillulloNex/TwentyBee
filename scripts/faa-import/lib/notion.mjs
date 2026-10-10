// Notion API client — paginated extraction with rate limiting.

import { Client } from '@notionhq/client';
import { NOTION_TOKEN, NOTION_PAGE_SIZE, NOTION_RATE_INTERVAL_MS } from '../config.mjs';

let _client = null;

function getClient() {
  if (!_client) {
    if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN is not set');
    _client = new Client({ auth: NOTION_TOKEN });
  }
  return _client;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Extract a flat value from a Notion property.
function extractProperty(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
      return prop.title?.map((t) => t.plain_text).join('') || null;
    case 'rich_text':
      return prop.rich_text?.map((t) => t.plain_text).join('') || null;
    case 'number':
      return prop.number;
    case 'select':
      return prop.select?.name || null;
    case 'multi_select':
      return prop.multi_select?.map((s) => s.name) || [];
    case 'date':
      return prop.date?.start || null;
    case 'checkbox':
      return prop.checkbox;
    case 'url':
      return prop.url;
    case 'email':
      return prop.email;
    case 'phone_number':
      return prop.phone_number;
    default:
      return null;
  }
}

// Flatten a Notion page into a simple { key: value } object.
function flattenPage(page) {
  const record = { _notionId: page.id };
  for (const [key, prop] of Object.entries(page.properties)) {
    record[key] = extractProperty(prop);
  }
  return record;
}

// Paginate through an entire Notion database.
// Calls onPage(records, cursor) after each page.
// If startCursor is provided, resumes from that cursor.
// Accepts optional filter for partitioned extraction.
export async function extractDatabase(databaseId, { onPage, startCursor = null, filter = null, log }) {
  const client = getClient();
  let cursor = startCursor;
  let hasMore = true;
  let totalExtracted = 0;

  while (hasMore) {
    const queryOpts = {
      database_id: databaseId,
      page_size: NOTION_PAGE_SIZE,
    };
    if (cursor) queryOpts.start_cursor = cursor;
    if (filter) queryOpts.filter = filter;

    let response;
    let retries = 0;
    while (true) {
      try {
        response = await client.databases.query(queryOpts);
        break;
      } catch (err) {
        retries++;
        if (retries > 5) throw err;
        const waitMs = err.status === 429 ? 10_000 : 2_000 * retries;
        if (log) log.warn(`Notion API error (attempt ${retries}/5): ${err.message}. Retrying in ${waitMs}ms...`);
        await sleep(waitMs);
      }
    }

    const records = response.results.map(flattenPage);
    totalExtracted += records.length;

    cursor = response.next_cursor;
    hasMore = response.has_more;

    await onPage(records, cursor);

    // Rate limit
    await sleep(NOTION_RATE_INTERVAL_MS);
  }

  return totalExtracted;
}

// Partition a large database extraction by first letter of the title property.
// This bypasses the Notion API's 10,000 result pagination limit.
// titleProperty: the name of the title property in the Notion database.
export async function extractDatabasePartitioned(databaseId, titleProperty, opts) {
  const { log } = opts;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const digits = '0123456789'.split('');
  const partitions = [...letters, ...digits];

  let grandTotal = 0;
  const seenIds = new Set(); // Deduplicate across partitions

  // Wrap onPage to deduplicate
  const originalOnPage = opts.onPage;
  const dedupOnPage = async (records, cursor) => {
    const unique = records.filter(r => {
      if (seenIds.has(r._notionId)) return false;
      seenIds.add(r._notionId);
      return true;
    });
    if (unique.length > 0) {
      await originalOnPage(unique, cursor);
    }
  };

  for (const char of partitions) {
    const filter = {
      property: titleProperty,
      title: { starts_with: char },
    };

    const count = await extractDatabase(databaseId, {
      ...opts,
      onPage: dedupOnPage,
      startCursor: null,
      filter,
    });

    grandTotal += count;
    if (log && count > 0) {
      log.info(`  Partition "${char}": ${count.toLocaleString()} records (running total: ${grandTotal.toLocaleString()})`);
    }
  }

  // Catch-all: records starting with special characters (not A-Z, 0-9)
  // Use a filter that excludes all known prefixes — query without filter and skip seen IDs
  if (log) log.info('  Partition "other": scanning for remaining records...');
  const otherCount = await extractDatabase(databaseId, {
    ...opts,
    onPage: dedupOnPage,
    startCursor: null,
    filter: null,
  });
  // otherCount includes all records but dedupOnPage filters to only new ones

  const uniqueTotal = seenIds.size;
  if (log) log.ok(`Partitioned extraction complete: ${uniqueTotal.toLocaleString()} unique records`);

  return uniqueTotal;
}
