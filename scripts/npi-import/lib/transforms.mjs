// Data transformations: CSV records → Twenty API payloads.
// Every transform preserves the full original record as rawSourceData.

import { DATA_SOURCE_TAG, DATA_SOURCE_DATE } from '../config.mjs';

function titleCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatPhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

function formatZip(raw) {
  if (!raw) return '';
  const zip = raw.replace(/\D/g, '');
  if (zip.length >= 9) return `${zip.slice(0, 5)}-${zip.slice(5, 9)}`;
  if (zip.length >= 5) return zip.slice(0, 5);
  return zip.padStart(5, '0');
}

function parseFloat_(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseInt_(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// ────────────────────────────────────────────────────────────
// FACILITY TRANSFORMS → healthcareFacility custom object
// ────────────────────────────────────────────────────────────

export function transformHospital(record) {
  return {
    name: titleCase(record['facility_name'] || 'Unknown'),
    facilityId: record['facility_id'] || '',
    facilityType: 'Hospital',
    hospitalType: record['hospital_type'] || '',
    ownership: record['hospital_ownership'] || '',
    overallRating: record['hospital_overall_rating'] || '',
    emergencyServices: record['emergency_services'] || '',
    phoneNumber: formatPhone(record['telephone_number']),
    birthdayFriendly: record['meets_criteria_for_birthing_friendly_designation'] || '',
    addressStreet: titleCase(record['address'] || ''),
    addressCity: titleCase(record['citytown'] || ''),
    addressState: (record['state'] || '').toUpperCase(),
    addressZip: formatZip(record['zip_code']),
    addressCountry: 'US',
    dataSource: `${DATA_SOURCE_TAG} — CMS Hospitals`,
    dataSourceDate: DATA_SOURCE_DATE,
    rawSourceData: record,
  };
}

export function transformHealthCenter(record) {
  return {
    name: titleCase(record['Site Name'] || 'Unknown'),
    facilityId: record['Health Center Number'] || '',
    npi: record['FQHC Site NPI Number'] || '',
    facilityType: record['Health Center Type'] || 'Health Center',
    ownership: record['Health Center Operator Description'] || '',
    phoneNumber: formatPhone(record['Site Telephone Number']),
    websiteUrl: record['Site Web Address'] || '',
    cmsRegion: record['Health Center Location Type Description'] || '',
    addressStreet: titleCase(record['Site Address'] || ''),
    addressCity: titleCase(record['Site City'] || ''),
    addressState: (record['Site State Abbreviation'] || '').toUpperCase(),
    addressZip: formatZip(record['Site Postal Code']),
    addressCountry: 'US',
    dataSource: `${DATA_SOURCE_TAG} — HRSA Health Centers`,
    dataSourceDate: DATA_SOURCE_DATE,
    rawSourceData: record,
  };
}

export function transformNursingHome(record) {
  return {
    name: titleCase(record['Provider Name'] || record['provider_name'] || 'Unknown'),
    facilityId: record['Federal Provider Number'] || record['federal_provider_number'] || '',
    facilityType: 'Nursing Home',
    ownership: record['Ownership Type'] || record['ownership_type'] || '',
    overallRating: record['Overall Rating'] || record['overall_rating'] || '',
    phoneNumber: formatPhone(record['Provider Phone Number'] || record['provider_phone_number'] || ''),
    numberOfBeds: parseInt_(record['Number of Certified Beds'] || record['number_of_certified_beds']),
    countyParish: record['Provider County Name'] || record['provider_county_name'] || '',
    fiveStarRating: record['Overall Rating'] || record['overall_rating'] || '',
    certificationDate: record['Date First Approved to Provide Medicare and Medicaid services'] || '',
    addressStreet: titleCase(record['Provider Address'] || record['provider_address'] || ''),
    addressCity: titleCase(record['Provider City'] || record['provider_city'] || ''),
    addressState: (record['Provider State'] || record['provider_state'] || '').toUpperCase(),
    addressZip: formatZip(record['Provider Zip Code'] || record['provider_zip_code'] || ''),
    addressCountry: 'US',
    facilityLatitude: parseFloat_(record['latitude']),
    facilityLongitude: parseFloat_(record['longitude']),
    dataSource: `${DATA_SOURCE_TAG} — CMS Nursing Homes`,
    dataSourceDate: DATA_SOURCE_DATE,
    rawSourceData: record,
  };
}

export function transformDialysis(record) {
  return {
    name: titleCase(record['Facility Name'] || 'Unknown'),
    ccn: record['CMS Certification Number (CCN)'] || '',
    facilityType: 'Dialysis Facility',
    fiveStarRating: record['Five Star'] || '',
    profitStatus: record['Profit or Non-Profit'] || '',
    chainOrganization: record['Chain Organization'] || '',
    numberOfStations: parseInt_(record['# of Dialysis Stations']),
    certificationDate: record['Certification Date'] || '',
    phoneNumber: formatPhone(record['Telephone Number'] || ''),
    countyParish: record['County/Parish'] || '',
    cmsRegion: record['Network'] || '',
    addressStreet: titleCase(record['Address Line 1'] || ''),
    addressStreet2: titleCase(record['Address Line 2'] || ''),
    addressCity: titleCase(record['City/Town'] || ''),
    addressState: (record['State'] || '').toUpperCase(),
    addressZip: formatZip(record['ZIP Code'] || ''),
    addressCountry: 'US',
    dataSource: `${DATA_SOURCE_TAG} — CMS Dialysis`,
    dataSourceDate: DATA_SOURCE_DATE,
    rawSourceData: record,
  };
}

export function transformHomeHealth(record) {
  const name = record['Provider Name'] || record['provider_name'] || 'Unknown';
  return {
    name: titleCase(name),
    ccn: record['CMS Certification Number (CCN)'] || record['cms_certification_number_ccn'] || '',
    facilityType: 'Home Health Agency',
    overallRating: record['Quality of Patient Care Star Rating'] || record['quality_of_patient_care_star_rating'] || '',
    phoneNumber: formatPhone(record['Telephone Number'] || record['telephone_number'] || ''),
    countyParish: record['County/Parish'] || record['countyparish'] || '',
    ownership: record['Type of Ownership'] || record['type_of_ownership'] || '',
    certificationDate: record['Date Certified'] || record['date_certified'] || '',
    addressStreet: titleCase(record['Address'] || record['address'] || ''),
    addressCity: titleCase(record['City/Town'] || record['citytown'] || ''),
    addressState: (record['State'] || record['state'] || '').toUpperCase(),
    addressZip: formatZip(record['ZIP Code'] || record['zip_code'] || ''),
    addressCountry: 'US',
    dataSource: `${DATA_SOURCE_TAG} — CMS Home Health`,
    dataSourceDate: DATA_SOURCE_DATE,
    rawSourceData: record,
  };
}

export function transformHospice(record) {
  return {
    name: titleCase(record['Facility Name'] || 'Unknown'),
    ccn: record['CMS Certification Number (CCN)'] || '',
    facilityType: 'Hospice',
    ownership: record['Ownership Type'] || '',
    phoneNumber: formatPhone(record['Telephone Number'] || ''),
    countyParish: record['County/Parish'] || '',
    certificationDate: record['Certification Date'] || '',
    cmsRegion: record['CMS Region'] || '',
    addressStreet: titleCase(record['Address Line 1'] || ''),
    addressStreet2: titleCase(record['Address Line 2'] || ''),
    addressCity: titleCase(record['City/Town'] || ''),
    addressState: (record['State'] || '').toUpperCase(),
    addressZip: formatZip(record['ZIP Code'] || ''),
    addressCountry: 'US',
    dataSource: `${DATA_SOURCE_TAG} — CMS Hospice`,
    dataSourceDate: DATA_SOURCE_DATE,
    rawSourceData: record,
  };
}

export function transformAmbulatorySurgery(record) {
  return {
    name: titleCase(record['Facility Name'] || 'Unknown'),
    facilityId: record['Facility ID'] || '',
    npi: record['NPI'] || '',
    facilityType: 'Ambulatory Surgical Center',
    phoneNumber: '',
    addressCity: titleCase(record['City/Town'] || ''),
    addressState: (record['State'] || '').toUpperCase(),
    addressZip: formatZip(record['ZIP Code'] || ''),
    addressCountry: 'US',
    dataSource: `${DATA_SOURCE_TAG} — CMS Ambulatory Surgery`,
    dataSourceDate: DATA_SOURCE_DATE,
    rawSourceData: record,
  };
}

// ────────────────────────────────────────────────────────────
// QUALITY MEASURE TRANSFORMS → qualityMeasure custom object
// ────────────────────────────────────────────────────────────

export function transformComplicationsMeasure(record) {
  return {
    facilityId: record['Facility ID'] || '',
    measureId: record['Measure ID'] || '',
    measureName: record['Measure Name'] || '',
    measureCategory: 'Complications & Deaths',
    score: record['Score'] || '',
    comparedToNational: record['Compared to National'] || '',
    sampleSize: record['Denominator'] || '',
    lowerEstimate: record['Lower Estimate'] || '',
    upperEstimate: record['Higher Estimate'] || '',
    startDate: record['Start Date'] || '',
    endDate: record['End Date'] || '',
    footnote: record['Footnote'] || '',
    dataSource: `${DATA_SOURCE_TAG} — CMS Complications/Deaths`,
    rawSourceData: record,
  };
}

export function transformHaiMeasure(record) {
  return {
    facilityId: record['Facility ID'] || '',
    measureId: record['Measure ID'] || '',
    measureName: record['Measure Name'] || '',
    measureCategory: 'Hospital-Acquired Infections',
    score: record['Score'] || '',
    comparedToNational: record['Compared to National'] || '',
    startDate: record['Start Date'] || '',
    endDate: record['End Date'] || '',
    footnote: record['Footnote'] || '',
    dataSource: `${DATA_SOURCE_TAG} — CMS HAI`,
    rawSourceData: record,
  };
}

export function transformHcahpsMeasure(record) {
  return {
    facilityId: record['Facility ID'] || '',
    measureId: record['HCAHPS Measure ID'] || '',
    measureName: record['HCAHPS Question'] || '',
    measureCategory: 'Patient Experience',
    score: record['HCAHPS Answer Percent'] || record['HCAHPS Linear Mean Value'] || '',
    sampleSize: record['Number of Completed Surveys'] || '',
    startDate: record['Start Date'] || '',
    endDate: record['End Date'] || '',
    footnote: record['HCAHPS Answer Percent Footnote'] || '',
    dataSource: `${DATA_SOURCE_TAG} — CMS HCAHPS`,
    rawSourceData: record,
  };
}

export function transformTimelyCareMeasure(record) {
  return {
    facilityId: record['Facility ID'] || '',
    measureId: record['Measure ID'] || '',
    measureName: record['Measure Name'] || '',
    measureCategory: 'Timely & Effective Care',
    score: record['Score'] || '',
    sampleSize: record['Sample'] || '',
    startDate: record['Start Date'] || '',
    endDate: record['End Date'] || '',
    footnote: record['Footnote'] || '',
    dataSource: `${DATA_SOURCE_TAG} — CMS Timely/Effective Care`,
    rawSourceData: record,
  };
}

export function transformReadmissionMeasure(record) {
  return {
    facilityId: record['Facility ID'] || '',
    measureId: '',
    measureName: record['Measure Name'] || '',
    measureCategory: 'Readmissions',
    score: record['Excess Readmission Ratio'] || '',
    sampleSize: record['Number of Discharges'] || '',
    lowerEstimate: record['Predicted Readmission Rate'] || '',
    upperEstimate: record['Expected Readmission Rate'] || '',
    startDate: record['Start Date'] || '',
    endDate: record['End Date'] || '',
    footnote: record['Footnote'] || '',
    dataSource: `${DATA_SOURCE_TAG} — CMS Readmissions`,
    rawSourceData: record,
  };
}

export function transformInteropMeasure(record) {
  return {
    facilityId: record['Facility ID'] || '',
    measureId: record['CEHRT ID'] || '',
    measureName: 'Promoting Interoperability of EHRs',
    measureCategory: 'Interoperability',
    score: record['Meets criteria for promoting interoperability of EHRs'] || '',
    startDate: record['Start Date'] || '',
    endDate: record['End Date'] || '',
    dataSource: `${DATA_SOURCE_TAG} — CMS Promoting Interop`,
    rawSourceData: record,
  };
}

// ────────────────────────────────────────────────────────────
// PERSON TRANSFORMS → Person standard object
// ────────────────────────────────────────────────────────────

export function transformDoctor(record) {
  const firstName = titleCase(record['Provider First Name'] || '');
  const middleName = titleCase(record['Provider Middle Name'] || '');
  const lastName = titleCase(record['Provider Last Name'] || '');

  const secSpecs = [
    record['sec_spec_1'],
    record['sec_spec_2'],
    record['sec_spec_3'],
    record['sec_spec_4'],
  ].filter(Boolean).join(', ');

  return {
    name: {
      firstName: middleName ? `${firstName} ${middleName}`.trim() : firstName,
      lastName,
    },
    npi: record['NPI'] || '',
    credential: record['Cred'] || '',
    primarySpecialty: record['pri_spec'] || '',
    secondarySpecialties: secSpecs || record['sec_spec_all'] || '',
    medicalSchool: record['Med_sch'] || '',
    graduationYear: record['Grd_yr'] || '',
    gender: record['gndr'] === 'M' ? 'Male' : record['gndr'] === 'F' ? 'Female' : '',
    telehealth: record['Telehlth'] === 'Y' ? 'Yes' : '',
    facilityName: record['Facility Name'] || '',
    phoneNumber: formatPhone(record['Telephone Number']),
    pacId: record['Ind_PAC_ID'] || '',
    enrollmentId: record['Ind_enrl_ID'] || '',
    nameSuffix: record['suff'] || '',
    orgPacId: record['org_pac_id'] || '',
    numOrgMembers: record['num_org_mem'] || '',
    acceptsMedicareAssignment: record['ind_assgn'] || '',
    groupMedicareAssignment: record['grp_assgn'] || '',
    addressStreet: titleCase(record['adr_ln_1'] || ''),
    addressStreet2: titleCase(record['adr_ln_2'] || ''),
    addressCity: titleCase(record['City/Town'] || ''),
    addressState: (record['State'] || '').toUpperCase(),
    addressZip: formatZip(record['ZIP Code']),
    dataSource: DATA_SOURCE_TAG,
    dataSourceDate: DATA_SOURCE_DATE,
    rawSourceData: record,
  };
}

// ────────────────────────────────────────────────────────────
// DEDUP KEYS
// ────────────────────────────────────────────────────────────

export function facilityDedupeKey(payload) {
  // Use facilityId or CCN as primary key (globally unique per CMS)
  if (payload.facilityId) return `fid:${payload.facilityId}`;
  if (payload.ccn) return `ccn:${payload.ccn}`;
  // Fallback: name|city|state
  const name = (payload.name || '').toLowerCase().trim();
  const city = (payload.addressCity || '').toLowerCase().trim();
  const state = (payload.addressState || '').toLowerCase().trim();
  return `name:${name}|${city}|${state}`;
}

export function personDedupeKey(record) {
  if (record['NPI'] || record.npi) return record['NPI'] || record.npi;
  const last = (record['Provider Last Name'] || record.name?.lastName || '').toLowerCase().trim();
  const first = (record['Provider First Name'] || record.name?.firstName || '').toLowerCase().trim();
  const state = (record['State'] || record.addressState || '').toLowerCase().trim();
  return `${last}|${first}|${state}`;
}

export function qualityDedupeKey(payload) {
  return `${payload.facilityId}|${payload.measureId || ''}|${payload.measureName}|${payload.measureCategory}`;
}
