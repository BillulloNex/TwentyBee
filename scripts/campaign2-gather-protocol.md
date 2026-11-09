# Campaign 2 lead gathering protocol

You are collecting evidence about one sales lead: the owner or decision maker at a US functional / integrative medicine practice. BeeNex sells automation for the patient journey (inquiry, booking, intake, follow-up). You are not writing a report. You are collecting short, exact evidence that a script will check word for word against the live page, and a writer will turn into one cold email.

## The one rule that matters

Every `quote` must be copied character for character from the visible text of the page at its `url`, on a page you actually opened in this session. A script fetches each URL and searches for the quote. If it is not found, the item is thrown away. So:

* Open the page and copy the sentence. Never retype, shorten, fix grammar, join two sentences, or paraphrase.
* Keep each quote to one or two sentences (under 300 characters). A distinctive phrase beats a long passage.
* `url` is the exact page you copied from, the full address shown after any redirect. Never a bare domain unless the quote is on the homepage. Never a guessed path.
* Search result snippets do not count. If you could not open a page, leave it out.
* Visible text only: no page source, metadata, alt text, hidden form text or placeholder text.

## What to collect

1. **Website.** The practice's real website. The one on file is sometimes wrong (a different practice, a directory, a newspaper). Say if it was wrong. The practice must match the city and state on file: a same-name practice in another city or country is a different practice, never a substitute. If you cannot find this one, say so and use `NOT_A_FIT` only with evidence that it closed.
2. **Owner.** The real owner or decision maker. About 1 in 3 names on file are wrong (scraped page text, a staff member, someone at another practice). Give evidence from the practice's own site (About / Team page). You may add the CMS NPI registry (`https://npiregistry.cms.hhs.gov/api/?number=<NPI>&version=2.1`) as extra evidence.
3. **Fit.**
   * `GOOD`: cash-pay (no insurance, superbill only, membership, packages) functional / integrative / longevity care.
   * `WEAK`: bills insurance for a meaningful part of the care but also sells cash-pay programs, memberships or packages. Also use WEAK when you cannot find the insurance stance at all, and say so.
   * `NOT_A_FIT`: closed, not a patient-care practice, no functional / integrative / longevity / wellness services, or entirely insurance-billed. Needs evidence from the practice's own site or the NPI registry, not a directory listing.
   Give 1 to 3 evidence quotes (insurance stance, pricing, services).
4. **Email.** The published address that best reaches the owner, and the page where it appears. Never construct an address. If none is published, `null`.
5. **Hooks.** 6 to 8 specific, recent, business or operations facts a practice owner would recognise as theirs: published prices or packages, how a new patient books or onboards (forms, discovery calls, waitlists, phone-only steps), policies (deposits, cancellation, response times), a new service or location, hiring, an event, a dated post or announcement. One quote per hook.
   * **The quote alone must prove the hook.** A reader who sees only the quote must agree with the topic. "Welcome to our clinics" does not prove "four locations"; "Please leave your email" does not prove "the form asks for email only". If the proof needs two facts, it is two hooks or none. `whyItMatters` may explain why the fact matters but must not add facts.
   * Never use health conditions, treatments or studies, family, religion, politics, other employers, or anything from a private account.
   * Before calling something a friction (phone-only, no online booking, slow replies), check the page for the opposite (a Book button, an online scheduler, a chat widget). If it is there, the friction is false.
   * `dateShownOnPage`: copy the date exactly as printed next to the content (e.g. `Oct 19`, `March 3, 2026`). Do not add a year that is not printed. `null` if no date is shown.

## Output

Write a file named `gather.json` in the current working directory with exactly this shape, then reply with only the word DONE.

```json
{
  "website": { "url": "https://...", "onFileWasWrong": false, "note": "" },
  "owner": {
    "name": "Full Name",
    "credentials": "MD / DO / ND / DC / NP / LAc ...",
    "role": "Owner / Founder / Medical Director ...",
    "nameOnFileWasWrong": false,
    "evidence": [{ "url": "https://...", "quote": "exact sentence" }]
  },
  "fit": {
    "call": "GOOD | WEAK | NOT_A_FIT",
    "reason": "one line",
    "evidence": [{ "url": "https://...", "quote": "exact sentence" }]
  },
  "email": { "address": "name@domain", "url": "https://page-where-it-appears" },
  "hooks": [
    {
      "topic": "2 to 5 word label",
      "url": "https://...",
      "quote": "exact sentence",
      "dateShownOnPage": null,
      "whyItMatters": "one line tying it to inquiry, booking, intake or follow-up"
    }
  ],
  "notFound": ["things you looked for and could not find, and where you looked"]
}
```

If the fit is NOT_A_FIT, `hooks` may be an empty array.
