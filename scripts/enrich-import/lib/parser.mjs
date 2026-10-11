import { readFileSync } from 'node:fs';

export function parseCSV(filePath) {
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

    const firstName = raw['First Name'] || '';
    const lastName = raw['Last Name'] || '';
    const company = raw['Company'] || '';
    let domain = (raw['Company Domain'] || '').toLowerCase().trim();
    domain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();

    const title = raw['Job Title'] || '';
    const email = (raw['Emails'] || '').toLowerCase().trim();
    let linkedin = raw['Linkedin'] || '';
    if (linkedin && !linkedin.startsWith('http://') && !linkedin.startsWith('https://')) {
      linkedin = 'https://' + linkedin;
    }

    let rawStatus = raw['Email Status'] || 'Unknown';
    let emailStatus = 'UNKNOWN';
    if (/published/i.test(rawStatus)) {
      emailStatus = /generic/i.test(rawStatus) ? 'GENERIC' : 'VERIFIED_PUBLIC';
    } else if (/pattern/i.test(rawStatus)) {
      emailStatus = 'PATTERN_DERIVED';
    }

    const decisionMaker = raw['Decision Maker']?.toLowerCase() === 'true';
    const emailSource = raw['Email Source'] || '';

    // Extract potential NPI mentioned in notes
    const npiMatch = emailSource.match(/\b(?:NPI|npino|npiprofile|npimap|npiindex|NPPES)\s*:?\s*(\d{10})\b/i) ||
                     emailSource.match(/\b(\d{10})\b/);
    const extractedNpi = npiMatch ? npiMatch[1] : null;

    // Detect state hint from company or notes
    const stateMatch = company.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|Maine|Alaska|Hawaii|California|Maryland|Massachusetts|Delaware|New Jersey|New York|Pennsylvania|Rhode Island|Florida|Texas)\b/i) ||
                       emailSource.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/);
    const stateHint = stateMatch ? stateMatch[1].toUpperCase() : null;

    return {
      rowIndex: idx + 1,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      company,
      domain,
      jobTitle: title,
      email,
      linkedin,
      emailStatus,
      decisionMaker,
      emailSource,
      extractedNpi,
      stateHint,
    };
  });

  return data;
}
