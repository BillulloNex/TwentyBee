# Campaign 3 writer brief (step 3 of gather -> check -> write)

You write one 3-email cold sequence per lead, sent Day 0 / Day 2 / Day 4 (Monday, Wednesday, Friday) as plain text from Javier at BeeNex. The leads own cash-pay functional / integrative / longevity practices. The angle: **"you look like a practice we just worked with."** The subject line must make sense to nobody but this owner, so they open it out of curiosity.

## Input

Each lead is `artifacts/campaign-3-leads/gather-runs/<C3-key>.json`, made by an agent and checked by a script that fetched every cited page. Every evidence item, tool and hook carries a `check`:

* `VERIFIED`, `CLOSE`, `RELOCATED` (use `url`, not `citedUrl`): usable. With CLOSE, quote the page's wording, not the agent's.
* `IN_PAGE_SOURCE` (tools only): the tool's domain is linked from the page. Usable to name the tool.
* `NOT_ON_PAGE`, `BROKEN_URL`, `PAGE_FAILED`, `MISSING_URL_OR_QUOTE`: unusable. Never build on these, including `subjectIdeas` built on them.

A lead may also have a second evidence file from another agent (`gather-runs-agy/<C3-key>.json`, same shape, checked the same way) that went deeper on social listening. Use usable items from both; when they disagree on owner or fit, open the page and decide.

Hooks have `source`: `OWNER_VOICE` (their podcast, video, interview, article, post, event) or `PRACTICE_SITE`.

## What BeeNex may claim (nothing else)

Pick the peer story that fits the lead; never mix their facts.

* **Yunique Medical** - "a cash-pay practice a lot like yours". They ran patient contact and intake in GoHighLevel and the clinical record in Charm. BeeNex connected the two: a new contact becomes a patient record in Charm, bookings, reschedules and cancellations sync, completed intake lands in the right encounter, and patient-specific custom compounds carry over. Live since August 31, 2026. Fits: anyone with a CRM / booking / intake tool separate from the EHR, GoHighLevel or Charm users, intake-heavy onboarding.
* **Biohax Scientific** - "an epigenetics company that works with practitioners". BeeNex pulled lab reports from several vendors (TruDiagnostic and others) into one structured pipeline and connected it to ordering, billing and notifications; lab-to-order processing went from multiple days to under 30 minutes per patient. Fits: lab-heavy practices (panels, epigenetic or advanced testing), supplement or compounding orders, Fullscript-heavy follow-up.
* Always true: BeeNex builds inside the tools a practice already uses, not another app on top. Say this in Email 1 or 2 (owners have told us they won't use anything outside their EHR).

No other clients, numbers, percentages, guarantees or timelines.

## Per lead

1. **Fit.** From usable fit evidence. GOOD = cash-pay functional / integrative / longevity. WEAK = meaningful insurance billing plus cash programs, or stance not found. NOT_A_FIT = closed, not a practice, or entirely insurance-billed. NOT_A_FIT means verdict FAIL and no emails.
2. **Owner.** Use the owner only if an owner evidence item is usable; otherwise open their About / Team page and confirm, or flag "owner unconfirmed".
3. **Subject line.** Prefer a usable `OWNER_VOICE` hook. Open its page and confirm: it is this owner (not a namesake), the quote means what the agent says, and it is not a health claim, diagnosis, family, religion or politics. Then pick or improve one of `subjectIdeas`, or write your own from that hook:
   * 2 to 5 words, lowercase, built from their own words or names (episode title, program name, a coined phrase, a number from their page).
   * Looks meaningless to anyone else; to them it reads "how does he know that?".
   * No pitch, no question mark, no "quick question", no "re:", no urgency, no health topics. A podcast or talk whose title names a disease, a drug or a treatment can still be referenced by its show name or episode number, never by its topic.
   * Prefer items from the last 12 months; an older item needs a stronger reason and a flag.
   * Good: `the 72 hour portal reply`, `three visits or five`, `the fullscript switch`. Bad: `automation for your practice`, `quick question about intake`.
   If no OWNER_VOICE hook survives, use the best PRACTICE_SITE hook and flag "site hook only".
4. **Tools.** Name a tool (Cerbo, Charm, Practice Better, Jane, Fullscript, GoHighLevel, Tebra, Athena, AtlasMD, Calendly, HubSpot...) only if a usable `tools` item shows it. Correct spellings: ChARM is "Charm", "Practice Better", "GoHighLevel", "Fullscript", "Cerbo".
5. **Write.**

**Email 1 (Day 0, 60 to 90 words)**
* `Hi <First>,` (first name only, no title).
* First sentence explains the subject line at once and stays inside the quote. Say where you saw it only if the source proves it ("your episode with...", "your talk at...").
* Bridge in one sentence to the peer story: Yunique or Biohax, in the allowed wording, and why it looks like them (a tool they share, a step their own page describes).
* One sentence: we build inside the tools they already use.
* Ask: one short question about a hand-off in their own practice (e.g. "Is there a step between Cerbo and Fullscript your team still does by hand?"). No call request, no link.
* `Javier`

**Email 2 (Day 2, 30 to 50 words)** - a warm bump that works even if Email 1 was never read: a different usable fact (ideally a booking / intake / lab step from their site), plus "happy to send a 2-minute video of what we built for <Yunique | Biohax> if that's easier than a call." `Javier`.

**Email 3 (Day 4, 40 to 60 words)** - last note, no guilt: "If you reply with one line on how <a specific step from their site> works today, I'll send back a short sketch of where we'd look first. No call needed." Close by naming the practice. `Javier`.

Style for all three: plain text, no links, no em dashes, no exclamation marks, no emojis, no bullet points, no "I hope this finds you well", no fake urgency. Paragraphs separated by one blank line. Never mention site errors, staff personal details, patients' health, or anything in `doNotMention`. An undated item is never "recent" or "upcoming".

## Output

Write a JSON array to the results file you are given, one object per lead, rewriting the whole file after each lead:

```json
{
 "key": "C3-1e1e1421",
 "verdict": "PASS | PASS_WITH_FIXES | FAIL",
 "fit": "GOOD | WEAK | NOT_A_FIT",
 "ownerName": "full name only",
 "ownerTitle": "credentials and role",
 "peerStory": "YUNIQUE | BIOHAX",
 "subjectLine": "lowercase subject",
 "subjectSource": { "source": "OWNER_VOICE | PRACTICE_SITE", "platform": "podcast | ...", "quote": "exact usable quote", "url": "https://..." },
 "email1": "full text, paragraphs separated by \n\n",
 "email2": "...",
 "email3": "...",
 "researchSummary": "300 to 700 characters: owner, practice, model and prices, insurance stance, tools, booking and intake as shown. Usable evidence only.",
 "sourceLinks": "newline-separated URLs of every fact used in the emails",
 "flags": "short notes for the human reviewer, empty if clean: owner unconfirmed, site hook only, weak fit, namesake risk, only one usable fact"
}
```

Do not write to Twenty or Linear and do not edit other files.
