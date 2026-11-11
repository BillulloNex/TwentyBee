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

* **Yunique Medical is the story in every Email 1.** It is the "practice a lot like yours". Allowed facts: a cash-pay practice; they handled patient contact and intake in GoHighLevel and kept the chart in Charm, so staff carried information from one to the other by hand; BeeNex connected the two so a new inquiry becomes a patient record, bookings, reschedules and cancellations sync, and completed intake lands in the right visit, all inside the tools they already had. Live since August 31, 2026. Never say Yunique's work involved labs or supplements.
* **Biohax Scientific is an optional second story, only in Email 2, only for lab-heavy practices** (panels, advanced or epigenetic testing, supplement or compounding orders). Allowed facts: "an epigenetics company that works with practitioners"; BeeNex pulled lab reports from several vendors into one place and tied them to ordering; lab-to-order went from multiple days to under 30 minutes per patient.
* Owners have told us they will not use anything outside their EHR, so make it clear the work happens inside the tools they already use. Say it in your own words, in their tool names where usable ("inside Cerbo", "without adding another app"), never as a stock sentence.

No other clients, numbers, percentages, guarantees or timelines.

## Per lead

1. **Fit.** From usable fit evidence. GOOD = cash-pay functional / integrative / longevity. WEAK = meaningful insurance billing plus cash programs, or stance not found. NOT_A_FIT = closed, not a practice, or entirely insurance-billed. NOT_A_FIT means verdict FAIL and no emails.
2. **Recipient and owner.** The email is sent to the recipient on file (name and address given next to each lead); that address was verified for that person. Always greet the recipient on file, never someone else. Use the owner only if an owner evidence item is usable; otherwise open their About / Team page and confirm. If the recipient is not the owner (practice manager, partner, operations, another clinician), write to them in their own role: the hand-off question suits whoever runs operations, and you may mention the owner by first name once if it helps. Hooks from the owner's public voice can still be used if you frame them as the practice's ("Dr. Walker's episode on..."). Flag "recipient is not the owner: <role>". If the recipient on file turns out not to work at the practice, verdict FAIL.
3. **Subject line.** Prefer a usable `OWNER_VOICE` hook. Open its page and confirm: it is this owner, shown by two matching details on that page (practice name, city, credentials, photo caption); a namesake risk you cannot rule out means you do not use it, the quote means what the agent says, and it is not a health claim, diagnosis, family, religion or politics. Then pick or improve one of `subjectIdeas`, or write your own from that hook:
   * 2 to 5 words, lowercase, built from their own words or names (episode title, program name, a coined phrase, a number from their page).
   * Looks meaningless to anyone else; to them it reads "how does he know that?".
   * No pitch, no question mark, no "quick question", no "re:", no urgency, no health topics. A podcast or talk whose title names a disease, a drug or a treatment can still be referenced by its show name or episode number, never by its topic.
   * Prefer items from the last 12 months; an older item needs a stronger reason and a flag.
   * Good: `the 72 hour portal reply`, `three visits or five`, `the fullscript switch`. Bad: `automation for your practice`, `quick question about intake`.
   If no OWNER_VOICE hook survives, use the best PRACTICE_SITE hook and flag "site hook only".
4. **Tools.** Name a tool (Cerbo, Charm, Practice Better, Jane, Fullscript, GoHighLevel, Tebra, Athena, AtlasMD, Calendly, HubSpot...) only if a usable `tools` item shows it. Correct spellings: ChARM is "Charm", "Practice Better", "GoHighLevel", "Fullscript", "Cerbo".
5. **Write.**

**Voice.** Javier is a person writing to another person, not a template. Warm, plain, a little informal, the way a founder writes to a peer he admires. Short sentences. Each email must read as if written only for this owner. Read it aloud; if a sentence could be pasted into another lead's email unchanged, rewrite it.

**Email 1 (Day 0, 50 to 80 words)**
* `Hi <First>,` with the recipient on file's first name only, no title.
* Open on the subject line's item in a natural way: quote their words or name the episode / program / milestone, and add one human reaction (why it stuck, what it says about how they run the practice). Say where you saw it only if the source proves it. Never write "hence the subject line" or explain that it is the subject line.
* Bridge to Yunique in one or two sentences: why their practice looks like Yunique (a step on their own page, a tool they use, how new patients come in), then what we built for Yunique in plain words, ending on it living inside the tools Yunique already had.
* Ask one short, specific question about a hand-off in their own practice, using their words or tools ("Is there a step between Practice Better and Fullscript your team still does by hand?"). No call request, no link.
* Sign `Javier` on its own line. Nothing after it.

**Email 2 (Day 2, 30 to 50 words)** - a warm bump that works even if Email 1 was never read: one different usable fact from their site (ideally booking, intake or labs), stated plainly, then the offer of "a 2-minute video of what we built for Yunique" (or Biohax, for lab-heavy practices). `Javier`.

**Email 3 (Day 4, 35 to 55 words)** - last note, light and without guilt (never write the words "no guilt"): invite one line on how a specific step from their site works today, in exchange for a short sketch of where we'd look first, no call needed. `Javier`.

The human reaction in Email 1 must be grounded in the item itself; never invent a fact about how they practice to make it fit.

Banned phrases: "no guilt", "hence the subject line", "I came across", "I hope", "just floating", "touching base", "circle back", "BeeNex builds inside the tools a practice already uses", "pipeline", "streamline", "leverage", "seamless", "Javier, for".

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
