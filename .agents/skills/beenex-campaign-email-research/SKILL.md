---
name: beenex-campaign-email-research
description: Research a BeeNex Campaign 1 prospect, choose an honest proof link, and stage personalized Day 0, Day 4, and Day 10 emails as Markdown for Codex review before any Twenty CRM update. Use for prospect-specific outreach drafting, not sending.
---

# BeeNex campaign email research

Produce three short, ready-to-review emails that make one plausible workflow relevant to the **specific recipient**. The Twenty templates define each email's job; their brackets are research prompts, not wording to fill mechanically. Preserve the user's requested offer, cadence, sender, and AI emphasis when adapting them.

**Two roles:** A producing agent researches and writes a local draft. The primary Codex assistant reviews that draft and is the only role that may copy approved emails into `20.beenex.cloud`. A draft file is not approval. Producing agents use Twenty for read-only lookup and never update cohort records or send email.

## 1. Identify the recipient and template

1. In Twenty, find the exact cohort record, including alternate spellings and other cohort objects when needed. Read its existing placeholders and email fields. Determine whether the target is a person or a published team mailbox. For a person, confirm the name and practice with the practice's site when possible. An exact email on the practice site plus a reliable source naming the person can resolve an abbreviated CRM name; an undated title supports past association, not a claim of current responsibility. Address a verified team mailbox as a team, without inventing a human owner. Resolve conflicting identities or addresses before personalizing or writing to CRM.
2. Read the **current** `Campaign 1 Email Templates` records for Day 0 with proof, Day 0 concise, Day 4, and Day 10. Use their intended sequence and current sender/CTA. Treat a previously drafted revision as current only if the user points to it or it is stored in the target record.
3. Confirm the target cohort and record ID for the draft file. If CRM access is unavailable, record the unresolved identity or record ID and continue only with research that can be verified. Sending requires separate explicit authorization and is outside this skill.

**Done when:** the exact CRM record, intended person or team mailbox, practice, and sequence are clear. A missing human name is not a blocker for a verified team mailbox; a conflicting or unidentified target is. CRM spelling and placeholders are leads, not proof of public claims.

## 2. Research one narrow workflow

Read the prospect's official About, services, patient journey, forms, booking, and relevant provider pages. Use official registries or other primary sources to resolve an identity conflict. Record each useful finding as `claim | source URL | what it supports | uncertainty`. Prefer a few verified facts over a long biography.

Choose **one** workflow the recipient owns or plausibly influences. Stay in that person's lane: a marketing contact may influence inquiry-to-consultation follow-up, while a clinician may own pre-visit review. For a team inbox, choose a local workflow the team can answer or route. Separate:

- **Observed:** what the public source actually says the practice does.
- **Hypothesis:** a handoff or preparation step that *might* take time.
- **Question:** how to test that hypothesis without claiming a problem exists.

Do not infer a broken process, duplicate entry, staffing shortage, software gap, cost, or time savings from the mere existence of forms or appointments. Ask whether staff review is needed instead of asking which manual step *still* exists. Do not guess pronouns. A clinician's title and surname are usually the safest salutation.

**Done when:** the opening fact has a source, the proposed workflow follows from that fact, and the email asks about any unverified pain rather than asserting it.

## 3. Pick proof that fits

Browse the current [BeeNex work index](https://beenex.ai/work) and open candidate pages. Compare them on:

| Test | Strong fit | Weak fit |
| --- | --- | --- |
| Workflow | Same information handoff or practitioner task | Same industry only |
| Audience | Similar operator and scale | Different buyer and operating model |
| Status | Delivered or used, with the exact claim on the page | Design study, proposal, or unverified outcome |

Select **at most one** URL. State exactly what BeeNex did for that client and do not transfer its result to this prospect. Preserve the page's scope and status: backend engineering with a handoff is not proof of a live AI feature, and appointment updates between systems are not proof that data entered a particular schedule. An adjacent delivered example can work when the shared step and its limit are explicit. A design study can show an approach, but must be labeled as a design study and never as delivered proof. Omit the URL if every candidate would distract or mislead; use the concise Day 0 template when there is no honest proof match. Check the final URL resolves and its page supports the email's claim; the index summary alone is insufficient.

If a relevant proof page exists, place it in Day 0 so the first email has a concrete anchor. Day 4 can name the part that carries over without repeating the whole case. [The Dr. Senyi example](references/dr-senyi-example.md) shows an adjacent fit and its limits; recheck those pages before reusing any fact.

**Done when:** the case link, client name, delivery status, and one-sentence claim all agree with the opened page.

## 4. Draft the sequence

- **Day 0:** specific subject, sourced observation, one workflow question, a concrete BeeNex role, the selected proof link if appropriate, and one 30-minute call request. Mention AI in terms of a possible task it could help with. For clinical work, keep interpretation and approval with the clinician. Do not imply the linked case proves an AI capability it does not describe.
- **Day 4:** reply in the same thread. Add one new useful detail: the relevant part of the proof, or a simple agenda for reviewing the workflow. Ask one low-pressure question. Do not paste the Day 0 pitch again.
- **Day 10:** brief final reply. Acknowledge that the workflow may already run well; offer one clear next step and close the loop. Avoid invented urgency, guilt, or an automatic promise to contact the person at a later date.

Write like a person addressing a busy operator: plain words, short paragraphs, no generic praise, jargon, or grand AI claims. Describe the possible AI action and its human reviewer in everyday words; terms such as "bounded AI task" belong in the research notes, not the email. Use the recipient's preferred professional name or the verified team name. Include the sender's sign-off in each body. A link should be a usable URL in a plain-text CRM field. If the sender treats a field as body-only, keep the subject outside that body; inspect the field's downstream use before saving.

## 5. Check and stage the draft

Before presenting or saving, read every sentence against the evidence ledger. Remove unsupported facts, implied diagnoses of the practice, invented metrics, stale locations, and claims that a design was deployed. Confirm that the first email's proof and the proposed use case genuinely connect. Replace every template instruction, sample URL, date marker, and unresolved bracket. Check the recipient name, link destination, sender, CTA, and that the three emails progress rather than repeat.

Use [the Markdown draft template](assets/draft-template.md) and save **one file per prospect** under `artifacts/campaign-1-email-drafts/pending/`. Name it `<cohort-object>--<full-record-id>.md`; if the ID is unresolved, use a clear name slug and mark the ID unresolved inside. Fill every template section, including the evidence links, case-fit rationale, subject/body for each day, unknowns, and `review_status: pending_codex_review`. Keep source links beside factual claims in the evidence section; the emails themselves need only the chosen proof link. Reopen an existing pending file before revising it so work from another agent is not lost. On resubmission, preserve the prior Codex decision under `## Review history`, record changes under `## Producer revision notes`, reset `reviewed_by` and `reviewed_at` to `null`, and leave `## Codex review` pending for the reviewer. A producer never records the new Codex verdict.

The dedicated draft directory is local and Git-ignored because prospect research and draft outreach should not be published in the repository by accident. Tell the user or primary Codex assistant the absolute path to the pending file. If the producer and reviewer do not share a filesystem, hand over the Markdown file itself. Do not mark your own draft approved or write its copy to Twenty.

**Done when:** the pending file exists, has all three emails, and another reviewer can trace every material claim to its source without repeating the research from scratch.

## 6. Codex review gate and CRM handoff

Only the primary Codex assistant handles this step. Read the pending Markdown and independently check recipient identity, current prospect sources, the case-study page and its delivery status, each claim in the emails, the proposed use-case fit, link behavior, and sequence quality. Correct the copy or return it for revision. On approval, set `review_status: approved_for_twenty`, fill `reviewed_by` and `reviewed_at`, record review notes, and move the file to `artifacts/campaign-1-email-drafts/approved/`. For a return, set `review_status: needs_revision` and leave it pending. The filename and record ID must still refer to the same person after review.

After approval, follow the task's publishing scope. A request to review drafts stops at approved Markdown. If the user assigned this prospect for the Campaign 1 draft-review-CRM workflow, approval is the final gate: proceed with the Twenty save without asking again. Do not process unrelated pending files merely because they exist. Before saving, inspect the exact record's existing values and how its email fields are consumed. If a field already contains materially different copy, resolve whether to replace it before writing. Copy only the approved subject/body text into the intended `day0Email`, `day4Email`, and `day10Email` fields, using plain URLs where those fields are plain text. Update all three fields in one record operation and read them back. On an exact match, set `review_status: synced_to_twenty`, fill `twenty_saved_at`, and record the CRM result in the approved file. If review fails, do not write; if a write or readback fails, report the actual CRM state and repair it before marking the file synced. No agent sends the emails as part of this workflow.

**Done when:** the review decision is recorded, and any authorized CRM update has been read back from the correct record. A producer's completed draft alone never satisfies this gate.
