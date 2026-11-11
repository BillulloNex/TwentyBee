# Campaign 4 research brief

You are researching behavioral health nonprofits (Mental Health America affiliates and Clubhouse International members) for BeeNex, a small firm that builds software for mental health and human-services organizations. BeeNex's reference project: Mental Health America of the Palm Beaches, where it replaced paper, email and spreadsheet case notes across three programs (Clubhouse, Mental Health Court, Peer Place) with one app: eight standardized forms, dictation, supervisor search and export, role-based access and audit logs. Case notes went from 15-20 minutes to 5-8 minutes.

Each input record is one website domain with: the directory listing(s) that point to it, the IRS 990 match our script found (it may be WRONG), and the text of up to 8 pages from the site (home, about, staff, leadership, contact...) plus every email address published on those pages.

## What to produce

For each input record, one JSON object:

```json
{
  "domain": "example.org",
  "orgName": "Name the site uses for the organization",
  "orgType": "NONPROFIT | GOVERNMENT | HOSPITAL_OR_HEALTH_SYSTEM | UNIVERSITY | OTHER",
  "irsMatchCorrect": true,
  "irsNote": "why the IRS legal name is or is not this organization (e.g. 'IRS match is NAMI San Francisco, a different org')",
  "programs": ["Clubhouse", "peer support", "case management", "housing", "..."],
  "documentationSignals": "Concrete evidence from the pages that staff do intake, case notes, forms or reporting across programs or sites (e.g. '4 programs in 3 counties, Medicaid-billed case management, state contract reporting'). Empty string if none.",
  "fit": "FIT | NOT_A_FIT | UNSURE",
  "fitReason": "one sentence",
  "summary": "2-3 plain sentences: what they do, how big, anything a cold email could honestly reference",
  "people": [
    {
      "name": "First Last",
      "title": "Executive Director",
      "roleType": "EXECUTIVE | OPERATIONS | PROGRAM | CLINICAL | CLUBHOUSE_DIRECTOR | OTHER",
      "email": "first@example.org or null",
      "emailEvidence": "page URL where this exact address is published, or 'Clubhouse International directory', or null",
      "sourceUrl": "page URL where the name and title appear"
    }
  ]
}
```

## Rules

- Use only what is in the input. Do not browse, do not use memory of these organizations.
- People: up to 3 per organization, in this priority: Executive Director / CEO / President; COO / Director of Operations / Deputy Director; Program Director / Clinical Director / Clubhouse Director. Skip board members, volunteers and front-line staff. The clubhouse director from the directory listing counts if the site does not contradict it.
- Only include a person whose full name and title are both explicitly on a page or in the directory listing. Never invent or complete a name.
- Email: only an address that appears verbatim in the page text, the published-email list, or the directory listing, and that clearly belongs to that person (their name in the local part, or printed next to their name). Generic inboxes (info@, contact@) are not personal emails; leave email null rather than assign one. Never construct or guess an address.
- If the site belongs to a larger agency that runs the clubhouse as one program (a county board, a hospital system, a multi-service agency), set orgName to the agency, and still list the clubhouse director plus the agency's executive.
- orgType GOVERNMENT for county/state agencies and community services boards. They are usually not a fit (procurement), mark fit NOT_A_FIT unless the pages show otherwise.
- fit FIT: nonprofit that runs direct services (clubhouse, peer support, case management, counseling, housing, crisis) with staff who document client work. NOT_A_FIT: volunteer-only or advocacy-only chapters with no direct-service staff, dead or parked sites, organizations that are not behavioral health. UNSURE otherwise.
- Keep summaries factual and specific. No marketing language.

Write the output as a JSON array to the output path you were given, one object per input record, in input order. Then reply with one line: the count of records, FIT / NOT_A_FIT / UNSURE counts, and the number of people found (and how many with an email).
