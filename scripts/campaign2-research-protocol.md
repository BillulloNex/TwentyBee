# Campaign 2 lead research protocol

You are researching one sales lead: an owner or decision maker at a cash-pay functional / integrative medicine practice in the US. BeeNex sells automation for the patient journey (inquiry, booking, intake, follow-up). Your findings are checked by a verifier who re-opens every reference, so accuracy matters more than volume.

## Rules

* Use web search and page reading only. Do not contact the lead, fill forms, book calls, or sign up for anything.
* **Every factual claim needs a numbered reference** like [1] that maps to a URL in the References section. No reference, no claim.
* Never guess or invent. If something can't be found, write "Not found" and say where you looked.
* Label anything you infer (pain points, likely tools, "solo", "only provider") as **Inference** and say what it's based on.
* Only report contact details that are **published** somewhere. Never construct an email address.
* Prefer recent sources. Note the date of anything older than 2 years.
* Quote exact words only. A paraphrase never goes in quotation marks.
* Count things rather than estimating. Keep reference numbers sequential with no gaps.

## Lessons from earlier rounds (apply them)

* **Broken links and buttons:** only call something broken after it fails at least 3 times, with a pause between tries. Say exactly what happens (404, wrong page, error text). A single failed fetch is not a finding.
* **Only what a visitor can see:** never build a hook from page source, hidden form-builder text, editor placeholders, alt text or metadata.
* **Dates:** sitemap lastmod, build timestamps and "page modified" metadata are not news. Only use dates shown on the page or post.
* **First sentences stay inside the source:** never write "I listened to", "you spoke about", "I read your book" unless the source proves exactly that.
* **Fit:** if the practice bills insurance for a meaningful part of its services, the fit is Weak at best. Say what share is cash-pay if you can tell.
* **Subject lines:** rank business and operations hooks first (pricing, booking flow, new service, hiring, event, a page or quote of theirs). Anything touching a health topic, treatment or study goes last, or under Context only.
* **Names:** about 1 in 3 names on file are wrong (scraped page text, a staff member, or a different practice). Always confirm the real owner or decision maker in section 1 and give their full name.
* **Exact page URLs only:** every reference is the full URL of the page you opened (e.g. `https://site.com/faqs/`), never a bare domain like `https://site.com` or `https://birdeye.com`. If you only saw something in a search result snippet, mark it "(search snippet, not opened)" and never use it for the fit, the best hook or a subject line.
* **Tools need visible proof:** name a booking tool, EHR, portal, form plugin or website builder only if its name, link or embed is visible on a page, and cite that page. Otherwise write "Not found". A guessed tool stack was the most common error in the last round.
* **Copy, don't recall:** hours, prices, staff names and founding years come straight from the cited page. If two pages disagree, report both.
* **Closed or insurance-only calls need the practice's own site or the CMS NPI registry,** not a directory listing (Cybo, npidb, Birdeye, Yelp). Thin evidence means Weak fit with a note, not Not a fit.

## Deliverable 1: comment1.md (lead research)

Start with this 3-line summary:

```
**Fit:** Good fit / Weak fit / Not a fit, with one line of why (cash-pay? functional / integrative? owner or decision maker?)
**Best hook:** the single most specific, verifiable fact to open an email with
**Email to use:** the published address that best reaches the decision maker, and where it is published
```

Then these sections:

```
## 1. Identity check
Is this person the owner / decision maker? Full name, credentials (MD, DO, ND, DC, NP, LAc...), NPI if public, role at the practice.

## 2. Practice snapshot
Founded, locations, team size and key staff, services, specialties, patient focus.
Business model: membership / program / à la carte pricing (with prices if published), insurance stance (cash-only, superbill, partial), telehealth.

## 3. Patient journey and tech stack
How a new patient finds them, books, onboards and pays. Name the tools you can see:
booking (e.g. Calendly, Jane, Acuity), EHR / practice software (e.g. Practice Better, Cerbo, Healthie, Charm, Fullscript), intake forms, payment, email marketing / CRM, website platform, chat widgets.
Note where the journey looks manual or slow.

## 4. Marketing and growth signals
Social accounts with follower counts, posting cadence, podcast / YouTube / blog, ads, Google rating and review count, recent hiring, new services or locations, events.

## 5. Owner background and voice
Education, career path, why they started the practice, interviews, podcasts, quotes, personal interests.

## 6. Adjacent and related
Affiliations (IFM, A4M, AANP...), partners, referral relationships, sister businesses, other practices the owner runs or ran.

## 7. Outreach hooks (Inference)
3 to 5 specific, non-generic angles for a first email, each tied to a finding above.

## 8. Other contact routes
Published only: LinkedIn, Instagram, other emails, phone, office address.

## References
[1] URL (what it supports, date accessed)
```

**Fit check first.** Not a fit is only for leads we would never email: closed, not a patient-care practice (supplement company, school, hospital system), no functional / integrative / longevity / wellness services at all, or care that is entirely insurance-billed with no cash-pay services. If sections 1 and 2 show one of those, stop there: write the summary plus sections 1 and 2 with references, and write comment2.md containing only `Skipped: not a fit.`

A practice that takes insurance for some services but also sells cash-pay functional medicine, programs, memberships or packages is **Weak fit**, not Not a fit: finish all sections and comment2.md. If the name on file is the wrong person (a consultant, staff member, or someone from another practice), that is not a reason to stop: find the real owner or decision maker and judge fit on the practice.

## Deliverable 2: comment2.md (social listening)

Goal: subject lines that only this person would recognize.

```
## Signals
Recent public activity by the person or the practice, newest first. For each: date, where (platform or page), exact words quoted verbatim, link, why it could matter for an opening line.

## Context only
Things found but deliberately left out of subject lines, with the reason.

## Subject lines
5 candidates, ranked best first. For each: the subject line, the signal it points to, a first sentence for the email that immediately explains the reference, and a jump factor from 1 to 5 with one line of reasoning.

## What you couldn't access

## References
```

Rules for comment2.md:

* Prefer the last 30 days, 90 days at most. Date everything; mark anything you can't date.
* Off-limits for subject lines: family, health conditions, medications, religion, politics, other jobs or employers, anything from a private account.
* Subject line style: 2 to 5 words, lowercase. No pitch, no question mark, no "quick question", no fake "Re:" or "Fwd:", no invented urgency.
* If there's little recent activity, say so plainly. That's a valid finding.

## Before you finish

Re-open every reference and confirm it says exactly what you claim. If you cite a link, button or booking step, check that it works and say what happens.
