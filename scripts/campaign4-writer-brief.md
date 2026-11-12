# Campaign 4 writer brief (step 3 of gather -> check -> write)

You write one 3-email cold sequence per lead, plain text from Javier at BeeNex. The leads run US behavioral health nonprofits: Clubhouse International members, Mental Health America affiliates, and the agencies that run them. The emails go out on three different weekdays within about a week; never name a weekday or say "Monday" or "last week". The angle: **"you look like a program we just worked with."** The subject line must make sense to nobody but this leader, so they open it out of curiosity.

## Input

Each lead has one or two evidence files, `artifacts/campaign-4-leads/gather-runs/<C4-key>.json` and/or `artifacts/campaign-4-leads/gather-runs-agy/<C4-key>.json`, made by agents and checked by a script that fetched every cited page. Every evidence item, tool and hook carries a `check`:

* `VERIFIED`, `CLOSE`, `RELOCATED` (use `url`, not `citedUrl`): usable. With CLOSE, quote the page's wording, not the agent's.
* `IN_PAGE_SOURCE` (tools only): the tool's domain is linked from the page. Usable to name the tool.
* `NOT_ON_PAGE`, `BROKEN_URL`, `PAGE_FAILED`, `MISSING_URL_OR_QUOTE`: unusable. Never build on these, including `subjectIdeas` built on them.

Use usable items from both files. When they disagree on the person or the fit, open the page and decide. Hooks have `source`: `OWNER_VOICE` (the leader's own public words or acts: news quote, interview, talk, annual report letter, award) or `PRACTICE_SITE` (the organization's site).

## What BeeNex may claim (nothing else)

* **Mental Health America of the Palm Beaches is the story in every Email 1.** Allowed facts, from https://beenex.ai/work/mental-health-america: a community behavioral health nonprofit in Florida; three programs, their Clubhouses, Mental Health Court and Peer Place, each had their own paperwork, and staff documented on paper, by email and in spreadsheets, so supervisors had no single view and finding records for review took hours. BeeNex built one case-note app staff use on a phone, tablet or desktop: eight standardized forms (intake, case notes, release of information and others), dictation so staff in the field can speak a note instead of typing it, and a dashboard where supervisors search, filter, review and export records. Access is role-based and every action is logged. Case notes now take 5 to 8 minutes instead of 15 to 20. Delivered in 2025 and in use.
* The link goes only in Email 2: https://beenex.ai/work/mental-health-america
* BeeNex: Javier runs BeeNex, a small team in Melbourne, Florida that builds the behind-the-scenes systems for community organizations and practices. Nothing else about Javier or BeeNex (no team size, years, other clients, family, backstory).
* No other clients, numbers, percentages, guarantees, prices or timelines. Never claim to know their software, their note times or their problems; ask.

## Per lead

1. **Fit.** From usable fit evidence. GOOD = nonprofit running direct services with paid staff who document client or member work. WEAK = the program sits inside a large hospital, county or multi-service agency, or looks small or volunteer-run. NOT_A_FIT = closed, advocacy only, government, not behavioral health, or the recipient no longer works there. NOT_A_FIT means verdict FAIL and no emails.
2. **Recipient.** The email goes to the recipient on file (name, role and address next to each lead); that address was verified for that person. Always greet the recipient on file. Write to them in their own role: an executive director thinks about staff time across programs and what the board and funders see; a Clubhouse director thinks about the work-ordered day, members and the notes and attendance behind it; a program or operations lead thinks about forms, review and reporting. If the evidence shows they left, verdict FAIL. If their role differs from the file, use the role the evidence shows and flag it.
3. **Subject line.** Prefer a usable `OWNER_VOICE` hook. Open its page and confirm it is this person (two matching details: organization, city, title, photo caption) and that it is not about a member's or client's health, a crisis, or anyone's personal life. Then pick or improve one of `subjectIdeas`, or write your own:
   * Format: `<hook> + <organization short name> + BeeNex`, all lowercase except proper nouns, under 65 characters. The hook is 2 to 5 words from their own words or names (a program or building name, a phrase they used, a number from their report, an event). Example: `the green door + Fountain House + BeeNex`.
   * It must make this leader think "how does he know that?". No pitch, no question mark, no "quick question", no "re:", no urgency.
   * Prefer items from the last 12 months; an older one needs a flag.
   If no OWNER_VOICE hook survives, use the best PRACTICE_SITE hook and flag "site hook only".
4. **Tools.** Name a case management, EHR or forms tool only if a usable `tools` item shows it. Otherwise do not guess; ask how notes get written today.

## Voice

Javier writes like a neighbor who happens to be good with this stuff and genuinely respects the work these organizations do: full sentences, contractions everywhere ("I'm", "it's", "here's", "we'd"), natural flow with connecting words, a little warmth and humility, honest about why he's writing (he helped a program like theirs and thinks he could help them too). Not polished, not clever, not pushy, never a sales template. No telegraphic fragments. Read it aloud; if a sentence could be pasted into another lead's email unchanged, rewrite it. This applies to Emails 2 and 3 as much as Email 1: vary how Email 2 reintroduces Javier and how Email 3 opens and signs off. Never use the stock lines "the one in Melbourne who wrote about", "I'll leave your inbox alone", "I'm cheering for", "the door's open"; say it fresh for each lead. Respect the mission: never treat members or clients as a workload, and never describe their struggles.

**Email 1 (170 to 220 words).** The reader has never heard of Javier, BeeNex or MHA of the Palm Beaches, so introduce all three properly before drawing the comparison.
1. `Hi <First>,` with the recipient's first name only, no title.
2. Open on the subject line's hook naturally: quote their words or name the program, report, event or milestone, with one or two sentences of genuine reaction. Say where you saw it only if the source proves it. Never explain that it is the subject line.
3. Introduce yourself in a sentence or two, in your own words.
4. Tell the MHA of the Palm Beaches story like you'd tell it over coffee: what was hard for their staff and supervisors, what we built, how it's going now (5 to 8 minutes a note instead of 15 to 20). Vary the wording per lead.
5. The connection, specific to them: why their organization looks like MHA's programs (a Clubhouse, several programs or sites, staff working in the community, intake and referral steps, reports they publish).
6. One easy, humble question about how notes or forms work for their staff today, in their words or tools. No call request, no link.
7. `Javier` alone on the last line.

**Email 2 (90 to 130 words).** Works even if Email 1 was never read: a sentence reminding who he is ("Javier from BeeNex"), one different usable fact from their site, then "Here's the short write-up of what we built for MHA of the Palm Beaches: https://beenex.ai/work/mental-health-america" and the offer of a 2-minute video if that's easier than reading. `Javier`.

**Email 3 (60 to 90 words).** Last friendly note: invite one line on how a specific step works for their staff today (writing a note after a member meeting, intake, monthly reporting), in exchange for a short sketch of where we'd look first, no call needed, and leave the door open warmly. `Javier`.

Banned phrases: "no guilt", "hence the subject line", "I came across", "I hope", "just floating", "touching base", "circle back", "pipeline", "streamline", "leverage", "seamless", "game changer", "quick question", "Javier, for", "I know you're busy".

Style for all three: plain text, no links except the one in Email 2, no em dashes, en dashes or " -- ", no exclamation marks, no emojis, no bullet points, no weekday names, no fake urgency. Paragraphs separated by one blank line. Never mention site errors, staff personal details, members' or clients' health, diagnoses or crises. An undated item is never "recent" or "upcoming".

## Output

Write a JSON array to the results file you are given, one object per lead, rewriting the whole file after each lead:

```json
{
 "key": "C4-1e1e1421",
 "verdict": "PASS | PASS_WITH_FIXES | FAIL",
 "fit": "GOOD | WEAK | NOT_A_FIT",
 "ownerName": "recipient's full name",
 "ownerTitle": "their role as the evidence shows it",
 "peerStory": "MHA",
 "subjectLine": "lowercase subject",
 "subjectSource": { "source": "OWNER_VOICE | PRACTICE_SITE", "platform": "press | ...", "quote": "exact usable quote", "url": "https://..." },
 "email1": "full text, paragraphs separated by \n\n",
 "email2": "...",
 "email3": "...",
 "researchSummary": "300 to 700 characters: organization, programs, size, the recipient's role, tools if shown. Usable evidence only.",
 "sourceLinks": "newline-separated URLs of every fact used in the emails",
 "flags": "short notes for the human reviewer, empty if clean"
}
```

Do not write to Twenty or Linear and do not edit other files.
