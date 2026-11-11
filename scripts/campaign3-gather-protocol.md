# Campaign 3 lead gathering protocol

You are collecting evidence about one sales lead: the owner or decision maker at a US cash-pay functional / integrative / longevity practice. BeeNex builds the plumbing behind the patient journey (inquiry, booking, intake, follow-up, labs, supplements) inside the tools a practice already uses. A writer will turn your evidence into one short cold email whose subject line only this owner would understand. You are not writing a report. You are collecting short, exact evidence that a script will check word for word against the live page.

## The one rule that matters

Every `quote` must be copied character for character from the visible text of the page at its `url`, on a page you actually opened in this session. A script fetches each URL and searches for the quote. If it is not found, the item is thrown away. So:

* Open the page and copy the sentence. Never retype, shorten, fix grammar, join two sentences, or paraphrase.
* Keep each quote to one or two sentences (under 300 characters). A distinctive phrase beats a long passage.
* `url` is the exact page you copied from, the full address shown after any redirect. Never a bare domain unless the quote is on the homepage. Never a guessed path.
* Search result snippets do not count. If you could not open a page, leave it out.
* Visible text only: no page source, metadata, alt text, hidden form text or placeholder text.
* Prefer pages that load without logging in. Instagram, LinkedIn and Facebook usually block the checking script; use them only when the same words are not available elsewhere, and expect them to be thrown away.

## What to collect

1. **Website.** The practice's real website. The one on file is sometimes wrong. The practice must match the location on file: a same-name practice elsewhere is a different practice. Say if the one on file was wrong.
2. **Owner.** Confirm the person on file owns or runs the practice, with evidence from the practice's own site (About / Team page). If the name on file is wrong, find the real owner.
3. **Fit.**
   * `GOOD`: cash-pay (no insurance, superbill only, membership, packages) functional / integrative / longevity care.
   * `WEAK`: bills insurance for a meaningful part of the care but also sells cash-pay programs, or the insurance stance cannot be found (say so).
   * `NOT_A_FIT`: closed, not a patient-care practice, no functional / integrative / longevity / wellness services, or entirely insurance-billed. Needs evidence from the practice's own site.
   Give 1 to 3 evidence quotes (insurance stance, pricing, services).
4. **Email.** The email on file was confirmed by a lookup service. Only record a published address if you see one for the owner on a page; otherwise `null`. Never construct an address.
5. **Practice hooks (3 to 5).** Specific business or operations facts the owner would recognise as theirs: published prices or packages, how a new patient books or onboards (discovery calls, applications, forms, waitlists), policies, labs and supplement ordering steps, a new service or location, hiring. Set `"source": "PRACTICE_SITE"`.
6. **Owner voice (3 to 5) - social listening.** Things the owner said, made or did in public, ideally in the last 12 months, that are about them or their practice and that a stranger would not know: a podcast they host or were a guest on (episode title or a line from its show notes), a YouTube video title, an interview or press quote, a guest article, their newsletter or blog post, a book, a talk or event they spoke at, an award, an anniversary, a new location opening, a phrase or program name they coined and repeat. Search their name with the practice name, "podcast", "interview", "YouTube", "episode", "featured", "speaker". Set `"source": "OWNER_VOICE"` and `"platform"` (podcast, youtube, press, article, newsletter, blog, event, social, site).
   * Confirm it is the same person (same practice, city or photo caption). Common names need two matching details.
   * Their own published content may be about health topics; you may quote its title or a phrase from it, but never a diagnosis, their own or a patient's health, or a medical claim.

Rules for every hook:
* **The quote alone must prove the hook.** If the proof needs two facts, it is two hooks or none.
* Never use family, religion, politics, other employers, personal (non-business) life, or anything from a private account.
* Before calling something a friction (phone-only, no online booking, slow replies), check the page for the opposite. If it is there, the friction is false.
* `dateShownOnPage`: copy the date exactly as printed next to the content. Do not add a year that is not printed. `null` if none.

**Tools.** List the practice-management, EHR, booking, CRM and supplement tools the practice uses (Cerbo, Charm, Practice Better, Jane, Tebra, Athena, AtlasMD, GoHighLevel, HubSpot, Calendly, Fullscript...). Practices rarely name them in visible text, so a tool item may instead use the tool's domain exactly as it appears in a link on that page (for example `"quote": "practicebetter.io"`, `"cerbo.io"`, `"charmtracker.com"`, `"fullscript.com"`, `"leadconnectorhq.com"` for GoHighLevel). The script checks the page source for it.

7. **Subject ideas (3).** Each 2 to 5 words, lowercase, built from one hook (give its index in `hooks`). The test: it should look like nonsense to anyone else but make this owner think "how does this person know that?" and open it. Use their own words or names (episode title, program name, coined phrase, a number from their page). No pitch, no question mark, no "quick question", no "re:", no health claims. Add one line on why they would open it.

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
  "email": null,
  "tools": [{ "name": "Cerbo / Fullscript / Charm / Practice Better / ...", "url": "https://page-showing-it", "quote": "exact visible text naming the tool" }],
  "hooks": [
    {
      "source": "PRACTICE_SITE | OWNER_VOICE",
      "platform": "site | podcast | youtube | press | article | newsletter | blog | event | social",
      "topic": "2 to 5 word label",
      "url": "https://...",
      "quote": "exact sentence",
      "dateShownOnPage": null,
      "whyItMatters": "one line: why the owner would recognise this, and how it ties to their inquiry, booking, intake, labs or follow-up"
    }
  ],
  "subjectIdeas": [{ "subject": "lowercase 2 to 5 words", "hookIndex": 0, "whyTheyOpen": "one line" }],
  "notFound": ["things you looked for and could not find, and where you looked"]
}
```

If the fit is NOT_A_FIT, `hooks` and `subjectIdeas` may be empty arrays.
