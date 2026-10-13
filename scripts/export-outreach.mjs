import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, '../outreach-campaign');
mkdirSync(outputDir, { recursive: true });

function loadEnv() {
  const envPaths = [resolve(__dirname, '.env'), resolve(__dirname, 'npi-import/.env')];
  for (const p of envPaths) {
    try {
      const content = readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[k]) process.env[k] = v;
        }
      }
      break;
    } catch {}
  }
}
loadEnv();

const apiKey = process.env.TWENTY_API_KEY;
const baseUrl = process.env.TWENTY_BASE_URL || "https://20.beenex.cloud";
if (!apiKey) {
  console.error("❌ Missing TWENTY_API_KEY in environment or .env");
  process.exit(1);
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

async function run() {
  console.log('[1/4] Fetching all contacts with emails and related company profiles...');
  let hasNextPage = true;
  let after = null;
  const allContacts = [];

  while (hasNextPage) {
    const afterClause = after ? `, after: "${after}"` : "";
    const q = `query {
      people(filter: { emails: { primaryEmail: { neq: "" } } }, first: 500${afterClause}) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            createdAt
            name { firstName lastName }
            emails { primaryEmail additionalEmails }
            phones { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode }
            jobTitle
            decisionMaker
            emailStatus
            emailSource
            linkedinLink { primaryLinkUrl }
            npi
            credential
            primarySpecialty
            secondarySpecialties
            taxonomyCode
            taxonomyDescription
            facilityName
            addressStreet
            addressCity
            addressState
            addressZip
            dataSource
            companyId
            company {
              id
              name
              domainName { primaryLinkUrl }
              websiteUrl
              phoneNumber
              companyType
              clinicianCount
              fitScore
              painPoints
              enrichmentStatus
              facilityType
              hospitalType
              address {
                addressStreet1
                addressCity
                addressState
                addressPostcode
              }
              linkedinLink { primaryLinkUrl }
            }
          }
        }
      }
    }`;

    const res = await fetch(`${baseUrl}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q })
    });

    const d = await res.json();
    if (d.errors) {
      console.error("GraphQL errors:", d.errors);
      throw new Error(d.errors[0].message);
    }

    const edges = d.data?.people?.edges || [];
    for (const edge of edges) {
      allContacts.push(edge.node);
    }

    hasNextPage = d.data?.people?.pageInfo?.hasNextPage;
    after = d.data?.people?.pageInfo?.endCursor;
  }

  console.log(`[2/4] Retrieved ${allContacts.length} contacts. Formatting data...`);

  // Build JSON export
  const jsonPath = resolve(outputDir, 'contacts_with_companies.json');
  writeFileSync(jsonPath, JSON.stringify(allContacts, null, 2), 'utf8');
  console.log(`Saved JSON to: ${jsonPath}`);

  // Build CSV export
  const csvHeaders = [
    'contact_id',
    'first_name',
    'last_name',
    'full_name',
    'primary_email',
    'email_status',
    'email_source',
    'job_title',
    'is_decision_maker',
    'contact_phone',
    'contact_linkedin',
    'credential',
    'primary_specialty',
    'taxonomy_description',
    'npi',
    'contact_city',
    'contact_state',
    'contact_zip',
    'company_id',
    'company_name',
    'company_domain',
    'company_phone',
    'company_clinician_count',
    'company_type',
    'company_city',
    'company_state',
    'company_zip',
    'company_linkedin',
    'data_source',
    'contact_created_at'
  ];

  const csvRows = [csvHeaders.join(',')];

  for (const c of allContacts) {
    const firstName = c.name?.firstName || '';
    const lastName = c.name?.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const primaryEmail = c.emails?.primaryEmail || '';
    const emailStatus = c.emailStatus || 'UNTAGGED';
    const emailSource = c.emailSource || '';
    const jobTitle = c.jobTitle || '';
    const isDecisionMaker = c.decisionMaker ? 'TRUE' : 'FALSE';
    const contactPhone = c.phones?.primaryPhoneNumber || '';
    const contactLinkedin = c.linkedinLink?.primaryLinkUrl || '';
    const credential = c.credential || '';
    const primarySpecialty = c.primarySpecialty || '';
    const taxonomyDescription = c.taxonomyDescription || '';
    const npi = c.npi || '';
    const contactCity = c.addressCity || '';
    const contactState = c.addressState || '';
    const contactZip = c.addressZip || '';
    const companyId = c.company?.id || c.companyId || '';
    const companyName = c.company?.name || c.facilityName || '';
    const companyDomain = c.company?.domainName?.primaryLinkUrl || c.company?.websiteUrl || '';
    const companyPhone = c.company?.phoneNumber || '';
    const companyClinicianCount = c.company?.clinicianCount != null ? c.company.clinicianCount : '';
    const companyType = c.company?.companyType || '';
    const companyCity = c.company?.address?.addressCity || '';
    const companyState = c.company?.address?.addressState || '';
    const companyZip = c.company?.address?.addressPostcode || '';
    const companyLinkedin = c.company?.linkedinLink?.primaryLinkUrl || '';
    const dataSource = c.dataSource || '';
    const createdAt = c.createdAt || '';

    const row = [
      escapeCsv(c.id),
      escapeCsv(firstName),
      escapeCsv(lastName),
      escapeCsv(fullName),
      escapeCsv(primaryEmail),
      escapeCsv(emailStatus),
      escapeCsv(emailSource),
      escapeCsv(jobTitle),
      escapeCsv(isDecisionMaker),
      escapeCsv(contactPhone),
      escapeCsv(contactLinkedin),
      escapeCsv(credential),
      escapeCsv(primarySpecialty),
      escapeCsv(taxonomyDescription),
      escapeCsv(npi),
      escapeCsv(contactCity),
      escapeCsv(contactState),
      escapeCsv(contactZip),
      escapeCsv(companyId),
      escapeCsv(companyName),
      escapeCsv(companyDomain),
      escapeCsv(companyPhone),
      escapeCsv(companyClinicianCount),
      escapeCsv(companyType),
      escapeCsv(companyCity),
      escapeCsv(companyState),
      escapeCsv(companyZip),
      escapeCsv(companyLinkedin),
      escapeCsv(dataSource),
      escapeCsv(createdAt),
    ];
    csvRows.push(row.join(','));
  }

  const csvPath = resolve(outputDir, 'contacts_with_companies.csv');
  writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
  console.log(`Saved CSV to: ${csvPath}`);

  // Build Analytics for Summary Guide
  console.log('[3/4] Generating ICP and campaign summary metrics...');
  const stats = {
    totalContacts: allContacts.length,
    withCompany: allContacts.filter(c => c.company).length,
    decisionMakers: allContacts.filter(c => c.decisionMaker).length,
    withPhone: allContacts.filter(c => c.phones?.primaryPhoneNumber || c.company?.phoneNumber).length,
    withLinkedin: allContacts.filter(c => c.linkedinLink?.primaryLinkUrl).length,
    emailStatuses: {},
    clinicianRanges: {
      'Solo / Micro (1-4)': 0,
      'Small (5-15)': 0,
      'Mid-Size (16-35)': 0,
      'Large (36-60)': 0,
      'Enterprise (60+)': 0,
      'Unspecified': 0,
    },
    topStates: {},
    topSpecialties: {},
    topRoles: {},
  };

  for (const c of allContacts) {
    const status = c.emailStatus || 'UNTAGGED';
    stats.emailStatuses[status] = (stats.emailStatuses[status] || 0) + 1;

    const state = c.company?.address?.addressState || c.addressState || 'Unknown';
    stats.topStates[state] = (stats.topStates[state] || 0) + 1;

    const spec = c.primarySpecialty || 'General / Unspecified';
    stats.topSpecialties[spec] = (stats.topSpecialties[spec] || 0) + 1;

    const title = c.jobTitle || 'Clinician / Provider';
    stats.topRoles[title] = (stats.topRoles[title] || 0) + 1;

    const cc = c.company?.clinicianCount;
    if (cc == null) {
      stats.clinicianRanges['Unspecified']++;
    } else if (cc < 5) {
      stats.clinicianRanges['Solo / Micro (1-4)']++;
    } else if (cc <= 15) {
      stats.clinicianRanges['Small (5-15)']++;
    } else if (cc <= 35) {
      stats.clinicianRanges['Mid-Size (16-35)']++;
    } else if (cc <= 60) {
      stats.clinicianRanges['Large (36-60)']++;
    } else {
      stats.clinicianRanges['Enterprise (60+)']++;
    }
  }

  // Generate Markdown ICP Guide
  const guidePath = resolve(outputDir, 'CAMPAIGN_ICP_GUIDE.md');
  const guideContent = `# Healthcare Outreach Campaign & ICP Segmentation Guide

Generated on **${new Date().toISOString().split('T')[0]}**  
Total Exported Outreach Contacts: **${stats.totalContacts}**

---

## 1. Executive Summary & Deliverables

This folder contains full contact information and associated medical practice profiles for **${stats.totalContacts} leads** ready for cold email outreach and sales qualification.

- **CSV Export:** \`contacts_with_companies.csv\` (Ready for SDRs, Google Sheets, Instantly, Smartlead, Apollo)
- **JSON Export:** \`contacts_with_companies.json\` (Nested data structure for programmatic workflows / CRM sync)
- **Primary Domain & Phone Match Rate:** **${((stats.withCompany / stats.totalContacts) * 100).toFixed(1)}%** of contacts are linked to verified practice companies.

---

## 2. Key ICP Quality Indicators

| Metric | Count | Coverage | Notes |
| :--- | :--- | :--- | :--- |
| **Total Reachable Contacts** | **${stats.totalContacts}** | 100% | All have valid non-empty email addresses |
| **Direct Decision Makers** | **${stats.decisionMakers}** | **${((stats.decisionMakers / stats.totalContacts) * 100).toFixed(1)}%** | Practice Owners, Administrators, CEOs, COOs, MD Partners |
| **Associated Practice Profile** | **${stats.withCompany}** | **${((stats.withCompany / stats.totalContacts) * 100).toFixed(1)}%** | Linked directly to company records in Twenty CRM |
| **Phone Available** | **${stats.withPhone}** | **${((stats.withPhone / stats.totalContacts) * 100).toFixed(1)}%** | Practice phone or direct provider phone |
| **LinkedIn Profile URL** | **${stats.withLinkedin}** | **${((stats.withLinkedin / stats.totalContacts) * 100).toFixed(1)}%** | Direct LinkedIn links for social touchpoints |

---

## 3. Email Confidence Status Breakdown

| Status | Count | Campaign Manager Recommendation |
| :--- | :--- | :--- |
${Object.entries(stats.emailStatuses).sort((a,b) => b[1] - a[1]).map(([status, count]) => {
  let rec = 'Direct primary campaign';
  if (status === 'VERIFIED_PUBLIC') rec = 'Tier 1 priority — Published publicly on clinic website or registry';
  else if (status === 'PATTERN_DERIVED') rec = 'Tier 1 / Tier 2 — High deliverability on verified domain pattern';
  else if (status === 'PLAUSIBLE') rec = 'Tier 2 — Pattern plausible; recommend catch-all verification';
  else if (status === 'RISKY') rec = 'Warm-up / Secondary pool or verify with MillionVerifier/NeverBounce';
  else if (status === 'NO_MATCH') rec = 'Needs manual SDR review before high-volume send';
  return `| **\`${status}\`** | **${count}** | ${rec} |`;
}).join('\n')}

---

## 4. Practice Size Segmentation (Clinician Count)

Use this segmentation to match pitch messaging (e.g. operational overhead for large clinics vs. staffing for small clinics):

| Practice Size Tier | Clinicians | Lead Count | Recommended Messaging Focus |
| :--- | :--- | :--- | :--- |
| **Solo / Micro** | 1 – 4 | **${stats.clinicianRanges['Solo / Micro (1-4)']}** | Owner bandwidth, reducing admin burden |
| **Small Clinic** | 5 – 15 | **${stats.clinicianRanges['Small (5-15)']}** | Patient throughput, billing efficiency, scaling provider time |
| **Mid-Size Practice** | 16 – 35 | **${stats.clinicianRanges['Mid-Size (16-35)']}** | Multi-provider coordination, operations manager workflow |
| **Large Group** | 36 – 60 | **${stats.clinicianRanges['Large (36-60)']}** | Multi-location management, enterprise compliance, executive reporting |
| **Enterprise / Health System** | 60+ | **${stats.clinicianRanges['Enterprise (60+)']}** | Regional scale, system integration, high-volume capacity |
| **Unspecified** | N/A | **${stats.clinicianRanges['Unspecified']}** | General specialty-focused approach |

---

## 5. Top Geographic Markets

Top states represented in the export:

${Object.entries(stats.topStates).sort((a,b) => b[1] - a[1]).slice(0, 10).map(([state, count], idx) => `${idx + 1}. **${state}**: ${count} leads`).join('\n')}

---

## 6. Recommended Outreach Sequences

### Sequence A: Practice Leadership (Administrators, COOs, CEOs)
- **Target Filter:** \`is_decision_maker = TRUE\` AND job title contains "Administrator", "Director", "Manager", "COO", "CEO"
- **Value Prop:** Operational efficiency, staffing, administrative automation, margin expansion.

### Sequence B: Physician Owners & Medical Directors
- **Target Filter:** \`is_decision_maker = TRUE\` AND \`credential\` in (MD, DO) or title contains "Owner", "Partner", "Medical Director"
- **Value Prop:** Clinical quality, physician burnout reduction, practice growth.
`;

  writeFileSync(guidePath, guideContent, 'utf8');
  console.log(`[4/4] Saved ICP Guide to: ${guidePath}`);
  console.log('\nEXPORT COMPLETED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
