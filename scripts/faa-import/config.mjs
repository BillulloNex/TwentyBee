// Central configuration — all constants, DB IDs, and field mappings.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency)
const envPath = resolve(__dirname, '.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not found — rely on system env vars
}

export const TWENTY_API_KEY = process.env.TWENTY_API_KEY;
export const TWENTY_BASE_URL = process.env.TWENTY_BASE_URL || 'https://20.beenex.cloud';
export const NOTION_TOKEN = process.env.NOTION_TOKEN;

export const NOTION_DB = {
  companies: process.env.NOTION_COMPANIES_DB,
  individuals: process.env.NOTION_INDIVIDUALS_DB,
  prices: process.env.NOTION_PRICES_DB,
};

// Twenty API constraints (self-hosted — no external rate limits)
export const TWENTY_BATCH_SIZE = 200;
export const TWENTY_RATE_LIMIT_PER_MIN = 1200;
export const TWENTY_RATE_INTERVAL_MS = 150; // balanced: 4x faster than original, stable on CF containers

// Notion API constraints
export const NOTION_PAGE_SIZE = 100;
export const NOTION_RATE_INTERVAL_MS = 340; // ~3 req/sec

// Data source tag applied to every record
export const DATA_SOURCE_TAG = 'FAA Releasable Aircraft';
export const DATA_SOURCE_DATE = '2026-10-01';

// State directory
export const STATE_DIR = resolve(__dirname, 'state');

// Phase order
export const PHASES = ['schema', 'companies', 'people', 'aircraft'];

// Aircraft custom object field definitions (for schema setup)
export const AIRCRAFT_FIELDS = [
  { name: 'nNumber', label: 'N-Number', type: 'TEXT' },
  { name: 'aircraftMake', label: 'Aircraft Make', type: 'TEXT' },
  { name: 'aircraftModel', label: 'Aircraft Model', type: 'TEXT' },
  { name: 'aircraftType', label: 'Aircraft Type', type: 'TEXT' },
  { name: 'serialNumber', label: 'Serial Number', type: 'TEXT' },
  { name: 'yearManufactured', label: 'Year Manufactured', type: 'NUMBER' },
  { name: 'airworthiness', label: 'Airworthiness', type: 'TEXT' },
  { name: 'status', label: 'Status', type: 'TEXT' },
  { name: 'certIssueDate', label: 'Cert Issue Date', type: 'TEXT' },
  { name: 'lastActivityDate', label: 'Last Activity Date', type: 'TEXT' },
  { name: 'expirationDate', label: 'Expiration Date', type: 'TEXT' },
  { name: 'modeSHex', label: 'Mode S Hex', type: 'TEXT' },
  { name: 'coOwners', label: 'Co-Owners', type: 'TEXT' },
  { name: 'usedValueLow', label: 'Used Value Low', type: 'NUMBER' },
  { name: 'usedValueHigh', label: 'Used Value High', type: 'NUMBER' },
  { name: 'usedValueTypical', label: 'Used Value Typical', type: 'NUMBER' },
  { name: 'newMsrp', label: 'New MSRP', type: 'NUMBER' },
  { name: 'dataSource', label: 'Data Source', type: 'TEXT' },
  { name: 'dataSourceDate', label: 'Data Source Date', type: 'TEXT' },
];

// Custom fields to add to Company
export const COMPANY_CUSTOM_FIELDS = [
  { name: 'companyType', label: 'Company Type', type: 'TEXT' },
  { name: 'dataSource', label: 'Data Source', type: 'TEXT' },
  { name: 'dataSourceDate', label: 'Data Source Date', type: 'TEXT' },
];

// Custom fields to add to Person
export const PERSON_CUSTOM_FIELDS = [
  { name: 'addressStreet', label: 'Address Street', type: 'TEXT' },
  { name: 'addressStreet2', label: 'Address Street 2', type: 'TEXT' },
  { name: 'addressCity', label: 'Address City', type: 'TEXT' },
  { name: 'addressState', label: 'Address State', type: 'TEXT' },
  { name: 'addressZip', label: 'Address ZIP', type: 'TEXT' },
  { name: 'addressCountry', label: 'Address Country', type: 'TEXT' },
  { name: 'dataSource', label: 'Data Source', type: 'TEXT' },
  { name: 'dataSourceDate', label: 'Data Source Date', type: 'TEXT' },
];
