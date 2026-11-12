# Campaign 3 revision brief (voice pass on finished drafts)

You are revising cold email sequences that are already researched, fact-checked and approved for content. Each lead's current draft (subject line, three emails, research summary, source links, flags) is in the drafts file you are given, next to the lead's evidence files. Rewrite the three emails in a fuller, warmer voice. Keep everything that is true and specific; change how it sounds.

## Why

Thomas read the drafts and said two things:

1. Readers do not know what Charm or GoHighLevel are. Say "Charm EHR" and "GoHighLevel CRM" the first time each appears in an email (later mentions in the same email can be "Charm" and "GoHighLevel"). Do the same for any other tool the reader may not know when it is the client's tool, not the reader's own ("Practice Better" is fine bare when the reader uses it).
2. The emails sound clipped, like someone cutting words to save space. Fragments such as "Live August 31." or "Fueling Endurance, the podcast title on your features page." read like a sales template. He wants the reader to think "this is a nice hometown guy trying to make a living", not "a sales guy".

## The voice

Javier runs a small team in Melbourne, Florida. He writes like a neighbor who happens to be good with this stuff: full sentences, a natural flow from one thought to the next, plain words, a little warmth and humility. He sounds genuinely interested in their practice and honest about why he is writing (he helped a practice like theirs and thinks he could help them too). He is not polished, not clever, not pushy.

* Talk the way people talk: contractions everywhere ("I'm", "it's", "here's", "we'd", "you've"). "I am", "It is", "Here is" sound stiff.
* Full sentences with connecting words ("so", "and", "which is why", "honestly"). No telegraphic fragments, no colon lists inside sentences.
* Tell the Yunique story like you would tell it over coffee: what was frustrating for their staff, what we did, how it is going now. Vary the wording per lead; never reuse one paragraph across leads.
* One or two sentences of genuine reaction to their hook or story are fine, as long as they stay specific to what the source says.
* Humble asks: "I'd love to hear", "if you're open to it", "no pressure at all". Make replying feel easy.
* Do not invent anything about Javier or BeeNex beyond: Javier runs BeeNex, a small team in Melbourne, Florida that builds the behind-the-scenes systems for practices, connecting the tools they already use. No family, hometown backstory, years in business, team size, or "I read every reply myself".
* Add no new facts about the lead. Use only the facts already in the current draft, reworded. Do not add episode topics, dates, deadlines, offers or details that are not in the draft, even if you think you saw them somewhere. Fill the extra length with warmth, the story told fully, and clearer reasoning, not with new claims.
* Keep the case study named exactly as the draft names it. If the draft says "a medical practice we work with" without naming Yunique, keep it unnamed.

## Lengths

* Email 1 (Day 0): 170 to 220 words. Same order as now: greeting, their hook, who Javier and BeeNex are, the Yunique story (or the case study the draft uses), why their practice looks similar, one easy question. No link.
* Email 2 (Day 2): 90 to 130 words. Reminder of who he is, a different fact from their site, the case-study link exactly as in the draft, the offer of a 2-minute video. Keep a Biohax sentence only if the draft already has one.
* Email 3 (Day 4): 60 to 90 words. Last friendly note, invites one line on how a specific step works today, offers a short sketch of where we'd look first, no call needed, and leaves the door open warmly.

## Keep exactly

* The subject line, verdict, fit, owner, peer story, researchSummary and sourceLinks (add a URL to sourceLinks only if you used a new fact).
* The recipient greeted (`Hi <First>,`) and `Javier` alone on the last line of each email.
* Every rule from the original brief: no em dashes or " -- ", no treatment, procedure, drug or injectable names, no exclamation marks, no emojis, no bullet points, no links except the case-study link in Email 2, no weekday references (say "earlier this week"), never mention site errors, staff personal details or patients' health.
* Banned phrases: "no guilt", "hence the subject line", "I came across", "I hope this finds you well", "I hope", "just floating", "touching base", "circle back", "pipeline", "streamline", "leverage", "seamless", "game changer", "Javier, for", "quick question".

## Output

Write a JSON array to the results file you are given, one object per lead, rewriting the whole file after each lead. Each object is the lead's draft object from the drafts file with `email1`, `email2`, `email3` replaced (and `sourceLinks` / `flags` updated only if needed). Same keys, same shape.

Do not write to Twenty or Linear and do not edit other files.
