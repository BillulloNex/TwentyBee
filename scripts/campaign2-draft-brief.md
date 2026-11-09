# Campaign 2 email drafting brief (Cohorts 2 to 4)

You write the 3-email cold sequence (Day 0, Day 4, Day 10) for one verified lead at a time. The voice, length and structure must match the Cohort 1 emails below, which are already being sent. The sender sends your text exactly as written, as plain text, signed "Javier". Javier works at BeeNex, which builds the follow-up layer for practices: routine patient questions answered between visits, and a good-fit inquiry turned into a booked first visit without back-and-forth.

## Input

`artifacts/campaign-2-leads/drafts-input.json`: one object per lead with `ownerName`, `practice`, `subjectLine` (already verified, keep it unless a rule below forces a change), `firstSentence` (the verified opening line), `verifiedFact` (exact quote and URL), `researchSummary`, `socialSignals` (one verified signal per line), `verifiedHooks` (exact page quotes that a script confirmed on the live page; may be empty for older leads), `fit` (GOOD or WEAK) and `doNotMention`.

## Hard rules

* **Only verified facts.** Every fact about the practice must come from `verifiedFact`, `verifiedHooks`, `socialSignals` or `researchSummary`. Quote page wording exactly when you put it in quotation marks. Never invent a price, tool, policy, date, name or number. If a fact is not in the input, leave it out.
* **Email 1 opens with the subject line's hook**, using `firstSentence` / `verifiedFact`. Email 2 uses a **different** verified fact, ideally about the inquiry → booking → intake handoff (discovery calls, forms, callbacks, deposits, waitlists, response times). If there is no second fact, Email 2 makes the handoff point in general terms without inventing specifics.
* **Tools:** name an EHR / booking tool (Cerbo, Practice Better, Jane, ChARM, MD-HQ, OptiMantra...) only if it appears in the input. Otherwise say "on top of the tools you already use". Use the vendor's correct spelling even if the input misspells it: OptiMantra, ChARM, Practice Better, Cerbo, MD-HQ, Jane, Healthie, Elation, Hint, Akute, IntakeQ, SimplePractice, Fullscript, Calendly, Acuity, Zocdoc, Tebra, Kareo.
* **Nothing that feels like surveillance:** don't mention a staff member's personal phone number, personal email, home address, or that their site has errors they would find embarrassing in public. Policies, prices, booking steps and published announcements are fine.
* **Fit wording:** GOOD fit = "cash-pay practices". WEAK fit = "practices like yours" (never call a practice cash-pay unless the input says it is).
* **Never mention:** health conditions, treatments, studies, patients' health, family, religion, politics, anything in `doNotMention`, or a hiring post as "current" when it is undated. A date with no year printed is "undated": don't imply it is upcoming.
* **First name:** greet with the owner's first name only ("Hi Jennifer,"). Strip titles and credentials. If `ownerName` looks wrong or is a company, use "Hi there," and flag it.
* Plain text. No em dashes, no exclamation marks, no emojis, no links, no bullet points, no "I hope this finds you well", no fake urgency, no "Re:". Paragraphs separated by one blank line. Sign off with `Javier` on its own line, nothing after.
* Length: Email 1 about 80 to 115 words, Email 2 about 60 to 90, Email 3 about 40 to 60.

## Structure (copy this shape)

**Email 1**
1. `Hi <First>,`
2. The hook: what their page says, quoted or closely paraphrased from the verified input, in 1 to 2 sentences.
3. One sentence on why that matters operationally (questions piling up for staff, the gap between a yes and a booked visit). Keep it about operations, never about their care.
4. `We build the follow-up layer for <cash-pay practices | practices like yours> on top of <tool | the tools you already use>: routine questions answered between visits, and a good-fit <discovery call | consult | inquiry | application> turned into a booked first visit without the back-and-forth.`
5. `Worth a 15-minute look?`
6. `Javier`

**Email 2**
1. `Hi <First>,`
2. `One more thought.` + the second verified fact about the booking/intake handoff + "That gap between <x> and <y> is where <cash-pay practices | practices> quietly lose people."
3. `We automate that handoff so <a good-fit / an accepted> <patient | client> gets a booking link, intake forms and reminders the same day. Happy to show you how it would sit inside <tool | your current setup>.`
4. `Javier`

**Email 3**
1. `Hi <First>,`
2. `I'll leave it here. If <hook 1 in a few words> or <hook 2 in a few words> ever starts eating your week, reply with one line and I'll send a short sketch of how we'd set it up for <practice short name>.`
3. `Javier`

## Examples already sent (Cohort 1)

Subject: the 72 hour portal reply

> Hi Mollyann,
>
> Your FAQ tells patients a portal question can take up to 72 hours to answer, and that intake, scheduling, labs, supplements and payments all run through Cerbo. That's a lot of practice riding on one inbox.
>
> We build the follow-up layer for cash-pay practices on top of tools like Cerbo: routine questions answered between visits, and a good-fit discovery call turned into a booked first visit without the back-and-forth.
>
> Worth a 15-minute look?
>
> Javier

> Hi Mollyann,
>
> One more thought. Your booking page says that after the free 10-minute call, "once a decision is made, our admin will reach out to set up your first appointment." That gap between a yes and a booked $250 visit is where cash-pay practices quietly lose people.
>
> We automate that handoff so an accepted patient gets a booking link, intake forms and reminders the same day. Happy to show you how it would sit inside Cerbo.
>
> Javier

> Hi Mollyann,
>
> I'll leave it here. If the 72-hour portal queue or the discovery-call handoff ever starts eating your week, reply with one line and I'll send a short sketch of how we'd set it up for Pomegranate.
>
> Javier

Subject: the fullscript switch

> Hi Stephanie,
>
> Your Supplements page says "Our supplement store is moving to Fullscript" and that "Our current store stays open through December 31, 2026."
>
> A switch like that tends to show up as routine patient questions between visits, on top of everything else the team is already answering.
>
> We build the follow-up layer for cash-pay practices on top of tools like MD-HQ: routine questions answered between visits, and a good-fit application turned into a booked first visit without the back-and-forth.
>
> Worth a 15-minute look?
>
> Javier

Subject: three visits or five

> Hi Natalie,
>
> Your older Roland Functional Medicine site lists the 16-week Full Support Package with "Three Client Health Visits," while your Wellness with Dr. Natalie services page lists it with "FIVE (5)" wellness visits. Both sites share one booking link, so a prospect comparing them may arrive unsure what they're signing up for.
>
> We build the follow-up layer for cash-pay practices on top of tools like Practice Better: routine questions answered between visits, and a discovery call turned into a booked first visit without the back-and-forth.
>
> Worth a 15-minute look?
>
> Javier

## Output

Write a JSON array to the file you are given, one object per lead:

```json
{
 "issue": "BEE-100",
 "subjectLine": "the subject line (unchanged unless a rule forced a change; then say why in flags)",
 "email1": "full plain text, paragraphs separated by \n\n",
 "email2": "...",
 "email3": "...",
 "flags": "short notes a human should check before sending (empty string if clean): owner unconfirmed, no published email, undated hook, weak fit, subject changed, only one usable fact"
}
```

Rewrite the whole file after each lead. Do not write to Twenty or Linear and do not edit other files.
