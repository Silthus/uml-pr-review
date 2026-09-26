# Sources for the Workflows theory draft

Harvested 2026-09-26 from PostHog/posthog, scopes `products/workflows`, `nodejs/src/cdp/services/hogflows`, since 2026-03-01.
Relevance filter: Jev classified 26 of 26 session turns; review comments go to clustering unfiltered.

## Collected

| What | Count |
| --- | --- |
| merged pull requests touching the scope | 579 |
| closed, unmerged pull requests touching the scope | 92 |
| inline review comments on those pull requests | 4265 |
| non-empty review bodies on those pull requests | 816 |
| t3 user turns in posthog sessions | 117 |
| claude-code user turns in posthog sessions | 329 |
| codex user turns in posthog sessions | 5 |
| agent guides above the scope | 2 |
| guidance documents in the scope | 8 |
| root config files read | 4 |

## Kept for clustering, and cited by rules

| Source | Kept | Cited |
| --- | --- | --- |
| bot-review | 1518 | 6 |
| review | 680 | 118 |
| session | 12 | 3 |
| doc | 291 | 25 |

## Dropped

| Source | Reason | Count |
| --- | --- | --- |
| review | inline comment on a file outside the scope | 2413 |
| review | review body on a PR with under 30% of its files in scope | 386 |
| review | acknowledgement or too short to carry a rule | 46 |
| review | comment written before --since | 38 |
| session | empty after removing injected context (skills, reminders, notifications) | 254 |
| session | repeat of an earlier turn, in the same session or another store | 70 |
| session | no correcting or constraining language | 64 |
| session | neither the turn nor its thread mentions the scope | 29 |
| session | Jev: process chatter, no constraint on code | 14 |
| session | longer than 4000 characters (pasted plan or document) | 8 |

## Notes

- 680 human review comments from 206 PRs; mayteio (299), dmarchuk (140) and meikelmosby (87) dominate. Many human-account comments are agent-written replies to bot findings (Claude Code, talyn.dev); they were used as evidence of the rule the author accepted, not as independent reviewers.
- About 190 'Fixed in / Thanks / LGTM' replies and one-off findings (UI copy, layout nits, SES metric math, rrule picker state, papaparse pinning) were ignored unless the same class recurred across PRs.
- Of 1518 bot comments (posthog 663, greptile 367, coderabbit 152, stamphog 95, veria 92), a handful were cited where they corroborated a human rule: secret masking, base_updated_at fencing, person:read scopes, blast-radius review.
- Code checks at 57ca357 found no workflows-specific semgrep or oxlint rules; most cross-language invariants (action types, row-scoped triggers, durations, trigger eligibility) are held by 'Keep in sync' comments, and products.workflows has no tach interface block.
- The 12 session turns are mostly workflows-as-code planning; one turn that was mostly a pasted teammate Slack message was not quoted, and only the read-only code-managed rule came from sessions.
- Scope: `products/workflows` plus `nodejs/src/cdp/services/hogflows`, the workflow runtime. CODEOWNERS gives team-workflows all of `nodejs/src/cdp`; the rest of CDP (destinations, hog functions) was left out to keep the draft about workflows.
- Sessions: T3 threads that run Claude also write the Claude Code store, so the same turn shows up twice and is counted once. Codex subagent sessions and Claude Code sidechains were skipped, but a T3 or Claude session an orchestrator started can still slip in, so every cited session quote was checked by hand to be Michael's own words.
- Jev on the AI gateway allowed 5 requests a minute, so it only classified session turns (5 per call). Review comments went to the Opus clustering pass unfiltered.
- Shape: PostHog's internal Coherence discussion (@daniloc and Marce Coll) argued for a project glossary and theory-first development, with a THEORY.md of vocabulary, abstractions, invariants, boundaries, and non-goals, and for component roles that carry guarantees. The ladder is Coherence's: convention, totality-checked, enshrined.
- Counts: an occurrence is one PR or session. Independent reviewers exclude the PR's own author, so a PR author accepting a bot finding counts as an occurrence but not as a reviewer. Authorless reviews (deleted accounts, some GitHub Apps) count as bots.
