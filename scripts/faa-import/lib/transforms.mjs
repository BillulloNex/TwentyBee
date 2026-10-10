// Data transformations: Notion records → Twenty API payloads.

import { DATA_SOURCE_TAG, DATA_SOURCE_DATE } from '../config.mjs';

// Split a full name like "SMITH JOHN A" into { firstName, lastName }.
// FAA format is usually "LASTNAME FIRSTNAME MIDDLE" — all caps.
export function splitName(fullName) {
  if (!fullName) return { firstName: '', lastName: '' };
  const name = fullName.trim();
  const parts = name.split(/\s+/);

  if (parts.length === 1) {
    return { firstName: '', lastName: titleCase(parts[0]) };
  }

  // FAA format: last name first, then first name(s)
  const lastName = titleCase(parts[0]);
  const firstName = parts.slice(1).map(titleCase).join(' ');
  return { firstName, lastName };
}

function titleCase(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Build a dedup key for companies: name|city|state (lowercased)
export function companyDedupeKey(record) {
  const name = (record['Company Name'] || '').toLowerCase().trim();
  const city = (record['City'] || '').toLowerCase().trim();
  const state = (record['State'] || '').toLowerCase().trim();
  return `${name}|${city}|${state}`;
}

// Build a dedup key for people: name|street|city|state (lowercased)
export function personDedupeKey(record) {
  const name = (record['Name'] || '').toLowerCase().trim();
  const street = (record['Street'] || '').toLowerCase().trim();
  const city = (record['City'] || '').toLowerCase().trim();
  const state = (record['State'] || '').toLowerCase().trim();
  return `${name}|${street}|${city}|${state}`;
}

// Transform a Notion company record → Twenty Company payload
export function transformCompany(record) {
  return {
    name: record['Company Name'] || 'Unknown',
    address: {
      addressStreet1: record['Street'] || '',
      addressStreet2: record['Street 2'] || '',
      addressCity: record['City'] || '',
      addressState: record['State'] || '',
      addressPostcode: record['ZIP'] || '',
      addressCountry: record['Country'] || 'US',
    },
    companyType: record['Company Type'] || '',
    dataSource: DATA_SOURCE_TAG,
    dataSourceDate: DATA_SOURCE_DATE,
  };
}

// Transform a Notion individual record → Twenty Person payload
export function transformPerson(record) {
  const { firstName, lastName } = splitName(record['Name']);
  return {
    name: {
      firstName,
      lastName,
    },
    addressStreet: record['Street'] || '',
    addressStreet2: record['Street 2'] || '',
    addressCity: record['City'] || '',
    addressState: record['State'] || '',
    addressZip: record['ZIP'] || '',
    addressCountry: record['Country'] || 'US',
    dataSource: DATA_SOURCE_TAG,
    dataSourceDate: DATA_SOURCE_DATE,
  };
}

// Transform a Notion record (company or individual) + pricing → Twenty Aircraft payload
export function transformAircraft(record, priceMap, ownerTwentyId, ownerType) {
  const makeModel = `${(record['Aircraft Make'] || '').trim()} ${(record['Aircraft Model'] || '').trim()}`.trim();
  const pricing = priceMap?.get(makeModel.toUpperCase()) || {};

  const aircraft = {
    nNumber: record['N-Number'] || '',
    aircraftMake: record['Aircraft Make'] || '',
    aircraftModel: record['Aircraft Model'] || '',
    aircraftType: record['Aircraft Type'] || '',
    serialNumber: record['Serial Number'] || '',
    yearManufactured: record['Year MFR'] || null,
    airworthiness: record['Airworthiness'] || '',
    certIssueDate: record['Cert Issue Date'] || '',
    lastActivityDate: record['Last Activity Date'] || '',
    expirationDate: record['Expiration Date'] || '',
    modeSHex: record['Mode S Hex'] || '',
    coOwners: record['Co-Owners'] || '',
    usedValueLow: pricing.usedLow || null,
    usedValueHigh: pricing.usedHigh || null,
    usedValueTypical: pricing.usedTypical || null,
    newMsrp: pricing.newMsrp || null,
    dataSource: DATA_SOURCE_TAG,
    dataSourceDate: DATA_SOURCE_DATE,
  };

  // Link to owner
  if (ownerType === 'company' && ownerTwentyId) {
    aircraft.ownerCompanyId = ownerTwentyId;
  } else if (ownerType === 'person' && ownerTwentyId) {
    aircraft.ownerPersonId = ownerTwentyId;
  }

  return aircraft;
}

// Build a price lookup key from a prices record
export function priceKey(record) {
  const make = (record['Make'] || '').trim();
  const model = (record['Model'] || '').trim();
  return `${make} ${model}`.toUpperCase();
}

// Transform a Notion price record into a simplified pricing object
export function transformPrice(record) {
  return {
    key: priceKey(record),
    usedLow: record['Used Low USD'] || null,
    usedHigh: record['Used High USD'] || null,
    usedTypical: record['Typical Used USD'] || null,
    newMsrp: record['New MSRP USD'] || null,
  };
}
