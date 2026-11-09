# Campaign 2 writer brief (step 3 of gather -> check -> write)

You turn checked evidence into one cold email opening per lead. BeeNex sells automation for the patient journey (inquiry, booking, intake, follow-up) to cash-pay functional / integrative medicine practices.

## Input

Each lead is a JSON file in `artifacts/campaign-2-leads/gather-runs/<BEE-n>.json`, made by an agent and then checked by a script that fetched every cited page. Every evidence item and hook carries a `check`:

* `VERIFIED`: the quote is on the page word for word. Usable.
* `CLOSE`: 90%+ of the quote's words are on the page in order. Usable, but quote the page wording, not the agent's.
* `RELOCATED`: the quote is word for word on another page of the same site; `url` is the corrected page (`citedUrl` was the agent's wrong one). Usable; cite `url`.
* `NOT_ON_PAGE`, `BROKEN_URL`, `PAGE_FAILED`, `MISSING_URL_OR_QUOTE`: unusable. Never build on these.

Email `check`: `VERIFIED` (visible on the page) or `MAILTO_ONLY` (only in a link) are usable; anything else is not.

## What you do per lead

1. **Fit.** Judge it from usable fit evidence only. Open the fit pages yourself if the call depends on the insurance stance. GOOD = cash-pay functional / integrative / longevity. WEAK = meaningful insurance billing plus cash programs, or insurance stance not found. NOT_A_FIT = closed, not a practice, or entirely insurance-billed, shown by the practice's own site or the NPI registry.
2. **Owner.** Use the owner only if an owner evidence item is usable. Otherwise open the practice's About / Team page and confirm it yourself, or mark the verdict PASS_WITH_FIXES and say the owner is unconfirmed.
3. **Hook.** Pick the best usable hook: specific, recognisable as theirs, about operations or business (pricing, booking, intake, policies, new service, hiring, events). Open its page and check two things the script cannot: the quote means what the agent says it means, and nothing on the same page contradicts the friction (for example a "phone only" hook next to a Book Online button). Drop hooks that fail.
4. **Write.**
   * Subject line: 2 to 5 words, lowercase, no pitch, no question mark, no "quick question", no fake "Re:", no urgency. It points at the hook.
   * First sentence: explains the subject line immediately, stays inside what the quote says, no "I read / I listened / you said" unless the source proves it. No health topics.
   * If no hook survives, verdict FAIL with the reason.

## Output

Write a JSON array to the results file you are given, one object per lead, in this shape (the shape `campaign2-apply-verified.mjs` reads):

```json
{
 "issue": "BEE-100",
 "verdict": "PASS | PASS_WITH_FIXES | FAIL",
 "fit": "GOOD | WEAK | NOT_A_FIT",
 "researchTool": "opus | gemini | sonnet | codex",
 "ownerName": "full name only",
 "ownerTitle": "credentials and role",
 "emailToUse": "usable published address or empty",
 "emailPublishedOn": "URL where it appears",
 "emailDiffersFromCard": false,
 "subjectLine": "chosen subject line, empty if NOT_A_FIT or FAIL",
 "firstSentence": "first sentence that explains the subject line",
 "verifiedFact": "the hook's exact page quote, with its URL",
 "researchSummary": "400 to 900 characters: owner, practice, model and prices, insurance stance, booking and intake as shown. Usable evidence only.",
 "socialSignals": "one line per usable hook: date shown or undated | page | exact quote | URL",
 "sourceLinks": "newline-separated URLs of usable evidence",
 "corrections": ["anything you dropped or changed and why"],
 "doNotMention": ["topics to keep out of outreach"]
}
```

Do not post to Linear or write to Twenty.
