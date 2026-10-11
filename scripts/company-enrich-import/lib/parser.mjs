import { readFileSync } from 'node:fs';

export function parseCompaniesCSV(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField);
      if (currentRow.length > 1 || currentRow[0] !== '') {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1).map((r, idx) => {
    const raw = {};
    headers.forEach((h, colIdx) => {
      raw[h] = (r[colIdx] || '').trim();
    });

    const name = raw['Name'] || '';
    let domain = (raw['Domain Name'] || '').toLowerCase().trim();
    domain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();

    let linkedin = raw['Linkedin'] || '';
    if (linkedin && !linkedin.startsWith('http://') && !linkedin.startsWith('https://')) {
      linkedin = 'https://' + linkedin;
    }

    const phoneNumber = raw['Phone Number'] || '';
    const street1 = raw['Address Street1'] || '';
    const city = raw['Address City'] || '';
    const state = raw['Address State'] || '';
    const postcode = raw['Address Postcode'] || '';

    const orgPacId = raw['Org PAC ID'] || '';
    const clinicianCount = raw['Clinician Count'] ? parseInt(raw['Clinician Count'], 10) : null;
    const fitScore = raw['Fit Score'] ? parseInt(raw['Fit Score'], 10) : null;
    const painPoints = raw['Pain Points'] || '';
    const enrichmentSources = raw['Enrichment Sources'] || '';

    let enrichmentStatus = 'PILOT_ENRICHED';
    const rawStatus = (raw['Enrichment Status'] || '').toLowerCase();
    if (rawStatus.includes('verified')) enrichmentStatus = 'VERIFIED';
    else if (rawStatus.includes('not')) enrichmentStatus = 'NOT_STARTED';

    return {
      rowIndex: idx + 1,
      name,
      domain,
      linkedin,
      phoneNumber,
      address: {
        addressStreet1: street1,
        addressStreet2: '',
        addressCity: city,
        addressState: state,
        addressPostcode: postcode,
        addressCountry: 'US',
      },
      orgPacId,
      clinicianCount,
      fitScore,
      painPoints,
      enrichmentSources,
      enrichmentStatus,
    };
  });

  return data;
}
