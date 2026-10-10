// Central configuration — all constants, data paths, custom objects, and field mappings.

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

// Twenty API constraints (self-hosted — no external rate limits)
export const TWENTY_BATCH_SIZE = 200;
export const TWENTY_RATE_INTERVAL_MS = 150;

// Data source tag applied to every record
export const DATA_SOURCE_TAG = 'NPI/NPPES';
export const DATA_SOURCE_DATE = '2026-10-08';

// Directories
export const DATA_DIR = resolve(__dirname, 'data');
export const STATE_DIR = resolve(__dirname, 'state');

// Phase order
export const PHASES = ['schema', 'facilities', 'quality', 'people', 'enrich', 'affiliations'];

// --- Data file paths ---

export const DATA_FILES = {
  // Primary people source
  cmsDoctors: resolve(DATA_DIR, 'people_sources/cms_doctors_clinicians.csv'),

  // NPPES full download (11 GB CSV inside zip)
  nppesZip: resolve(DATA_DIR, 'nppes_raw/nppes_full.zip'),
  nppesMainFile: 'npidata_pfile_20050523-20260809.csv',
  nppesEndpointFile: 'endpoint_pfile_20050523-20260809.csv',

  // Taxonomy code lookup
  taxonomyCodes: resolve(DATA_DIR, 'nppes_raw/taxonomy_codes.json'),

  // Facility sources
  cmsHospitals: resolve(DATA_DIR, 'gov_data/cms_hospitals.csv'),
  hrsaHealthCenters: resolve(DATA_DIR, 'gov_data/hrsa_health_centers.csv'),
  cmsNursingHomes: resolve(DATA_DIR, 'gov_data/cms_nursing_homes.csv'),
  cmsDialysis: resolve(DATA_DIR, 'gov_data/cms_dialysis.csv'),
  cmsHomeHealth: resolve(DATA_DIR, 'gov_data/cms_home_health.csv'),
  cmsHospice: resolve(DATA_DIR, 'gov_data/cms_hospice.csv'),
  cmsAmbulatorySurgery: resolve(DATA_DIR, 'gov_data/cms_ambulatory_surgery.csv'),

  // Quality measure sources
  cmsComplicationsDeaths: resolve(DATA_DIR, 'gov_data/cms_complications_deaths.csv'),
  cmsHaiHospital: resolve(DATA_DIR, 'gov_data/cms_hai_hospital.csv'),
  cmsHcahps: resolve(DATA_DIR, 'gov_data/cms_hcahps_patient_experience.csv'),
  cmsTimelyEffectiveCare: resolve(DATA_DIR, 'gov_data/cms_timely_effective_care.csv'),
  cmsHospitalReadmissions: resolve(DATA_DIR, 'gov_data/cms_hospital_readmissions.csv'),
  cmsPromotingInterop: resolve(DATA_DIR, 'gov_data/cms_promoting_interop.csv'),

  // PECOS enrollment (for affiliations)
  cmsPecos: resolve(DATA_DIR, 'gov_data/cms_pecos_ppef.csv'),
};

// --- Custom Object: healthcareFacility ---

export const FACILITY_OBJECT = {
  nameSingular: 'healthcareFacility',
  namePlural: 'healthcareFacilities',
  labelSingular: 'Healthcare Facility',
  labelPlural: 'Healthcare Facilities',
  description: 'Hospitals, health centers, nursing homes, dialysis centers, and other CMS/HRSA-registered healthcare facilities',
  icon: 'IconBuildingHospital',
};

export const FACILITY_FIELDS = [
  { name: 'facilityId', label: 'Facility ID', type: 'TEXT' },
  { name: 'npi', label: 'NPI', type: 'TEXT' },
  { name: 'ccn', label: 'CCN', type: 'TEXT' },
  { name: 'facilityType', label: 'Facility Type', type: 'TEXT' },
  { name: 'hospitalType', label: 'Hospital Type', type: 'TEXT' },
  { name: 'ownership', label: 'Ownership', type: 'TEXT' },
  { name: 'overallRating', label: 'Overall Rating', type: 'TEXT' },
  { name: 'emergencyServices', label: 'Emergency Services', type: 'TEXT' },
  { name: 'phoneNumber', label: 'Phone Number', type: 'TEXT' },
  { name: 'websiteUrl', label: 'Website URL', type: 'TEXT' },
  { name: 'certificationDate', label: 'Certification Date', type: 'TEXT' },
  { name: 'numberOfBeds', label: 'Number of Beds', type: 'NUMBER' },
  { name: 'numberOfStations', label: 'Number of Stations', type: 'NUMBER' },
  { name: 'chainOrganization', label: 'Chain Organization', type: 'TEXT' },
  { name: 'cmsRegion', label: 'CMS Region', type: 'TEXT' },
  { name: 'countyParish', label: 'County/Parish', type: 'TEXT' },
  { name: 'birthdayFriendly', label: 'Birthing Friendly', type: 'TEXT' },
  { name: 'profitStatus', label: 'Profit Status', type: 'TEXT' },
  { name: 'fiveStarRating', label: 'Five Star Rating', type: 'TEXT' },
  { name: 'addressStreet', label: 'Address Street', type: 'TEXT' },
  { name: 'addressStreet2', label: 'Address Street 2', type: 'TEXT' },
  { name: 'addressCity', label: 'Address City', type: 'TEXT' },
  { name: 'addressState', label: 'Address State', type: 'TEXT' },
  { name: 'addressZip', label: 'Address ZIP', type: 'TEXT' },
  { name: 'addressCountry', label: 'Address Country', type: 'TEXT' },
  { name: 'facilityLatitude', label: 'Latitude', type: 'NUMBER' },
  { name: 'facilityLongitude', label: 'Longitude', type: 'NUMBER' },
  { name: 'dataSource', label: 'Data Source', type: 'TEXT' },
  { name: 'dataSourceDate', label: 'Data Source Date', type: 'TEXT' },
  { name: 'rawSourceData', label: 'Raw Source Data', type: 'RAW_JSON' },
];

// --- Custom Object: qualityMeasure ---

export const QUALITY_OBJECT = {
  nameSingular: 'qualityMeasure',
  namePlural: 'qualityMeasures',
  labelSingular: 'Quality Measure',
  labelPlural: 'Quality Measures',
  description: 'CMS hospital quality scores, infection rates, patient experience, readmissions, and interoperability metrics',
  icon: 'IconChartBar',
};

export const QUALITY_FIELDS = [
  { name: 'facilityId', label: 'Facility ID', type: 'TEXT' },
  { name: 'measureId', label: 'Measure ID', type: 'TEXT' },
  { name: 'measureName', label: 'Measure Name', type: 'TEXT' },
  { name: 'measureCategory', label: 'Measure Category', type: 'TEXT' },
  { name: 'score', label: 'Score', type: 'TEXT' },
  { name: 'comparedToNational', label: 'Compared to National', type: 'TEXT' },
  { name: 'sampleSize', label: 'Sample Size', type: 'TEXT' },
  { name: 'lowerEstimate', label: 'Lower Estimate', type: 'TEXT' },
  { name: 'upperEstimate', label: 'Upper Estimate', type: 'TEXT' },
  { name: 'startDate', label: 'Start Date', type: 'TEXT' },
  { name: 'endDate', label: 'End Date', type: 'TEXT' },
  { name: 'footnote', label: 'Footnote', type: 'TEXT' },
  { name: 'dataSource', label: 'Data Source', type: 'TEXT' },
  { name: 'rawSourceData', label: 'Raw Source Data', type: 'RAW_JSON' },
];

// --- Custom Object: providerAffiliation ---

export const AFFILIATION_OBJECT = {
  nameSingular: 'providerAffiliation',
  namePlural: 'providerAffiliations',
  labelSingular: 'Provider Affiliation',
  labelPlural: 'Provider Affiliations',
  description: 'Links healthcare providers (people) to the facilities where they practice',
  icon: 'IconLink',
};

export const AFFILIATION_FIELDS = [
  { name: 'npi', label: 'NPI', type: 'TEXT' },
  { name: 'facilityId', label: 'Facility ID', type: 'TEXT' },
  { name: 'facilityName', label: 'Facility Name', type: 'TEXT' },
  { name: 'providerType', label: 'Provider Type', type: 'TEXT' },
  { name: 'specialty', label: 'Specialty', type: 'TEXT' },
  { name: 'dataSource', label: 'Data Source', type: 'TEXT' },
];

// --- Enhanced Person fields ---

export const PERSON_CUSTOM_FIELDS = [
  { name: 'npi', label: 'NPI', type: 'TEXT' },
  { name: 'credential', label: 'Credential', type: 'TEXT' },
  { name: 'primarySpecialty', label: 'Primary Specialty', type: 'TEXT' },
  { name: 'secondarySpecialties', label: 'Secondary Specialties', type: 'TEXT' },
  { name: 'medicalSchool', label: 'Medical School', type: 'TEXT' },
  { name: 'graduationYear', label: 'Graduation Year', type: 'TEXT' },
  { name: 'gender', label: 'Gender', type: 'TEXT' },
  { name: 'telehealth', label: 'Telehealth', type: 'TEXT' },
  { name: 'facilityName', label: 'Facility Name', type: 'TEXT' },
  { name: 'phoneNumber', label: 'Phone Number', type: 'TEXT' },
  { name: 'pacId', label: 'PAC ID', type: 'TEXT' },
  { name: 'enrollmentId', label: 'Enrollment ID', type: 'TEXT' },
  { name: 'nameSuffix', label: 'Name Suffix', type: 'TEXT' },
  { name: 'orgPacId', label: 'Org PAC ID', type: 'TEXT' },
  { name: 'numOrgMembers', label: 'Org Member Count', type: 'TEXT' },
  { name: 'acceptsMedicareAssignment', label: 'Accepts Medicare Assignment', type: 'TEXT' },
  { name: 'groupMedicareAssignment', label: 'Group Medicare Assignment', type: 'TEXT' },
  { name: 'pecosProviderType', label: 'PECOS Provider Type', type: 'TEXT' },
  { name: 'taxonomyCode', label: 'Taxonomy Code', type: 'TEXT' },
  { name: 'taxonomyDescription', label: 'Taxonomy Description', type: 'TEXT' },
  { name: 'licenseNumber', label: 'License Number', type: 'TEXT' },
  { name: 'licenseState', label: 'License State', type: 'TEXT' },
  { name: 'addressStreet', label: 'Address Street', type: 'TEXT' },
  { name: 'addressStreet2', label: 'Address Street 2', type: 'TEXT' },
  { name: 'addressCity', label: 'Address City', type: 'TEXT' },
  { name: 'addressState', label: 'Address State', type: 'TEXT' },
  { name: 'addressZip', label: 'Address ZIP', type: 'TEXT' },
  { name: 'dataSource', label: 'Data Source', type: 'TEXT' },
  { name: 'dataSourceDate', label: 'Data Source Date', type: 'TEXT' },
  { name: 'rawSourceData', label: 'Raw Source Data', type: 'RAW_JSON' },
];
