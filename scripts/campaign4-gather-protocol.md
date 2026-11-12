# Campaign 4 lead gathering protocol

You are collecting evidence about one sales lead: a leader at a US behavioral health nonprofit (a Mental Health America affiliate or a Clubhouse International member, or the agency that runs one). BeeNex is a small team in Melbourne, Florida that builds the software behind the paperwork: intake, case notes, forms, supervisor review and funder reporting, inside or alongside the tools the organization already uses. Its reference project is Mental Health America of the Palm Beaches, where case notes across three programs went from 15-20 minutes to 5-8 minutes. A writer will turn your evidence into a short, warm cold email whose subject line only this person would understand. You are not writing a report. You are collecting short, exact evidence that a script will check word for word against the live page.

## The one rule that matters

Every `quote` must be copied character for character from the visible text of the page at its `url`, on a page you actually opened in this session. A script fetches each URL and searches for the quote. If it is not found, the item is thrown away. So:

* Open the page and copy the sentence. Never retype, shorten, fix grammar, join two sentences, or paraphrase.
* Keep each quote to one or two sentences (under 300 characters). A distinctive phrase beats a long passage.
* `url` is the exact page you copied from, the full address shown after any redirect. Never a bare domain unless the quote is on the homepage. Never a guessed path.
* Search result snippets do not count. If you could not open a page, leave it out.
* Visible text only: no page source, metadata, alt text, hidden form text or placeholder text. PDFs (annual reports, 990s) are fine if they open as text.
* Prefer pages that load without logging in. LinkedIn, Facebook and Instagram usually block the checking script; use them only when the same words are not available elsewhere.

## What to collect

1. **Website.** The organization's real website. Say if the one on file is wrong. A same-name organization in another state is a different organization.
2. **Contact (the `owner` block).** Confirm the person on file works there in the role on file, with evidence from the organization's own site (staff, leadership, about, contact page) or the Clubhouse International directory. If they have left, say who holds the role now. `role` is their actual title.
3. **Fit.**
   * `GOOD`: a nonprofit that runs direct services (clubhouse, peer support, case management, counseling, housing, crisis, court programs) with paid staff who document client work, ideally across several programs, sites or counties.
   * `WEAK`: direct services exist but look small or volunteer-run, or the clubhouse is one program inside a large hospital, county or multi-service agency where software is decided elsewhere.
   * `NOT_A_FIT`: closed, advocacy or education only, government agency, or not behavioral health.
   Give 1 to 3 evidence quotes (programs, staff size, sites, funding).
4. **Email.** The email on file was verified. Only record a different published address if you see one for this person on a page; otherwise `null`. Never construct an address.
5. **Organization hooks (3 to 5).** Specific facts this leader would recognise as theirs: a program they launched or expanded, a new building or site, numbers from their annual report (members served, meals, jobs placed), Clubhouse accreditation, a state contract or grant award, a capital campaign, a hiring push, how members or clients are referred and enrolled, what reports they publish. Set `"source": "PRACTICE_SITE"`.
6. **Leader voice (3 to 5), social listening.** Things this person said, wrote or did in public, ideally in the last 12 months: a quote in local news, an op-ed, a podcast or radio interview, a conference talk (Clubhouse International, state behavioral health associations, MHA national), a letter in the annual report, a newsletter column, an award, a work anniversary, a phrase they repeat. Search their name with the organization name, "interview", "podcast", "said", "op-ed", "conference", "award". Set `"source": "OWNER_VOICE"` and `"platform"` (press, podcast, youtube, article, newsletter, report, event, social, site).
   * Confirm it is the same person (same organization or city). Common names need two matching details.
   * Never quote anything about a client's or member's health, a diagnosis, a crisis event, or their own personal health.
7. **Budget timing.** If a page shows the fiscal year (annual report period, "fiscal year ending June 30"), a budget, strategic plan or funding cycle, add it as a PRACTICE_SITE hook with topic "fiscal year" or "funding cycle".

Rules for every hook:
* **The quote alone must prove the hook.** If the proof needs two facts, it is two hooks or none.
* Never use family, religion, politics, other employers, personal (non-work) life, or anything from a private account.
* Never treat a struggle the organization describes about its clients as a business problem.
* `dateShownOnPage`: copy the date exactly as printed next to the content. Do not add a year that is not printed. `null` if none.

**Tools.** List the case management, EHR, CRM, forms and reporting tools they use (Credible, Netsmart myAvatar or myEvolv, CareLogic, Welligent, TherapyNotes, SimplePractice, Apricot or Bonterra, CaseWorthy, Penelope, Salesforce, Google Workspace, JotForm, Clubhouse management tools...). Organizations rarely name them in visible text, so a tool item may instead use the tool's domain exactly as it appears in a link on that page (for example `"quote": "socialsolutions.com"`, `"jotform.com"`, `"simplepractice.com"`). The script checks the page source for it. Job postings often name the system ("experience with Credible preferred"); those count.

8. **Subject ideas (3).** Each 2 to 5 words, lowercase, built from one hook (give its index in `hooks`). The test: it should look like nonsense to anyone else but make this leader think "how does this person know that?" and open it. Use their own words or names (program name, a number from their report, a phrase from their interview, their building or event name). No pitch, no question mark, no "quick question", no "re:", nothing about clients' health. Add one line on why they would open it.

## Output

Write a file named `gather.json` in the current working directory (or the output path you were given) with exactly this shape, then reply with only the word DONE.

```json
{
  "website": { "url": "https://...", "onFileWasWrong": false, "note": "" },
  "owner": {
    "name": "Full Name",
    "credentials": "LCSW / MSW / PhD ... or empty",
    "role": "Executive Director / Clubhouse Director / ...",
    "nameOnFileWasWrong": false,
    "evidence": [{ "url": "https://...", "quote": "exact sentence" }]
  },
  "fit": {
    "call": "GOOD | WEAK | NOT_A_FIT",
    "reason": "one line",
    "evidence": [{ "url": "https://...", "quote": "exact sentence" }]
  },
  "email": null,
  "tools": [{ "name": "Credible / Apricot / ...", "url": "https://page-showing-it", "quote": "exact visible text or linked domain" }],
  "hooks": [
    {
      "source": "PRACTICE_SITE | OWNER_VOICE",
      "platform": "site | press | podcast | youtube | article | newsletter | report | event | social",
      "topic": "2 to 5 word label",
      "url": "https://...",
      "quote": "exact sentence",
      "dateShownOnPage": null,
      "whyItMatters": "one line: why this leader would recognise it, and how it ties to intake, case notes, forms or reporting"
    }
  ],
  "subjectIdeas": [{ "subject": "lowercase 2 to 5 words", "hookIndex": 0, "whyTheyOpen": "one line" }],
  "notFound": ["things you looked for and could not find, and where you looked"]
}
```

If the fit is NOT_A_FIT, `hooks` and `subjectIdeas` may be empty arrays.
