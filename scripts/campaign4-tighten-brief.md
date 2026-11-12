# Campaign 4 Email 1 tightening brief

You are tightening the first cold email (`email1`) of finished, fact-checked Campaign 4 sequences. Each lead's current draft is in the drafts file you are given. Rewrite `email1` only. Keep `email2`, `email3` and every other field exactly as they are.

## Why

Thomas read the drafts and said: the first email should be no more than 3 paragraphs plus 1 call-to-action sentence, and each paragraph should be shorter. "It's not about saying 100% with 50% clarity or importance, but saying the 50% that is going to land 100%, with the same warm tone and vibe."

So: pick the strongest material and cut the rest. Fewer facts, said better. The reader should finish it in 20 seconds and feel it was written by a warm, genuine person who noticed something real about them.

## Shape

```
Hi <First>,

<Paragraph 1: the hook. 1 to 2 sentences. Their own words, program, event or milestone, and one genuine human reaction.>

<Paragraph 2: who and the story. 2 to 3 sentences. Javier runs BeeNex, a small team in Melbourne, Florida. What we built for Mental Health America of the Palm Beaches and the result: notes went from 15 to 20 minutes down to 5 to 8, and the total cloud cost to run it is about 9 cents a month.>

<Paragraph 3: why them. 1 to 2 sentences. The single most specific reason their organization looks like MHA's programs.>

<One CTA sentence: one easy, humble question about how notes or forms work for their staff today.>

Javier
```

* 80 to 130 words in total, greeting and sign-off included.
* The CTA is a single sentence on its own line, phrased as a question. No call request, no link.
* Keep the subject line's hook in paragraph 1 so the subject still makes sense.
* Keep the two numbers (5 to 8 instead of 15 to 20, about 9 cents a month in total cloud cost). Never imply the 9 cents is BeeNex's price.
* Drop the rest of the MHA detail (three programs, paper and spreadsheets, eight forms, dictation, dashboard) unless one short phrase of it is what makes the comparison land for this lead. The write-up link in Email 2 covers the rest.

## Voice (unchanged)

Warm, plain, a little humble, the way a neighbor who's good with this stuff writes. Contractions everywhere. Full sentences, never telegraphic fragments. Respect the mission; never treat members or clients as a workload. If a sentence could be pasted into another lead's email unchanged, rewrite it.

## Keep exactly

* The greeting name and `Javier` alone on the last line.
* Every fact must already be in the current draft. Add nothing new.
* No em dashes, en dashes or " -- ", no exclamation marks, no emojis, no bullet points, no links, no weekday names. Banned phrases: "no guilt", "hence the subject line", "I came across", "I hope", "touching base", "circle back", "pipeline", "streamline", "leverage", "seamless", "game changer", "quick question", "I know you're busy".

## Output

Write a JSON array to the results file you are given, one object per lead, rewriting the whole file after each lead. Each object is the lead's draft object from the drafts file with only `email1` replaced. Same keys, same shape. Do not edit other files.
