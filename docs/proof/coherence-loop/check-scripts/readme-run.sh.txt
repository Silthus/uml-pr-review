#!/bin/zsh
c=/tmp/wf73/check.sh
out=/Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868/docs/proof/coherence-loop/readme-check.txt
cd /Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868

print -r -- "# README \"Coherence loop\" commands, run in README order on 2026-09-26 (macOS, zsh), from the root of this repository." > $out
print -r -- "# Every command ran exactly as written, except where a note says otherwise." >> $out

print -r -- $'\n## 1. Prerequisites' >> $out
zsh $c 'bun install'
zsh $c 'gh auth status'
zsh $c 'git -C ~/dev/posthog remote -v'

print -r -- $'\n## 2. Score a product' >> $out
zsh $c 'bun coherence/index.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master'

print -r -- $'\n## 3. Backfill the history and read the report' >> $out
print -r -- "# The backfill and the build rewrite the tracked coherence/data and docs/coherence report. This PR restores them afterwards: refreshing the committed report is outside its scope." >> $out
zsh $c 'bun coherence/backfill.ts --repo ~/dev/posthog --scopes products/workflows,products/surveys,products/error_tracking --ref upstream/master'
zsh $c 'bun coherence/report/build.ts --repo ~/dev/posthog --modules products/workflows --github PostHog/posthog'
zsh $c 'open docs/coherence/index-report.html'

print -r -- $'\n## 4. Rank targets' >> $out
zsh $c 'bun coherence/targets.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master --posthog-signals coherence/signals/reports/workflows-ci-2026-09-26.json'

print -r -- $'\n## 5. Run one iteration (dry run)' >> $out
print -r -- $'\n$ bun coherence/loop/session.ts --repo ~/dev/posthog --scope products/workflows --fetch' >> $out
print -r -- "# This is the proof run itself, started at $(cat /tmp/wf73/session-start.txt); it is not run a second time here. Its launcher output (session-output.json):" >> $out
cat /tmp/wf73/session-output.txt >> $out
print -r -- "# exit 0 in 325 s (21 turns, \$0.60). The full log is transcript-tools.md; the raw stream is transcript.jsonl." >> $out

print -r -- $'\n## 6. Review the dry run' >> $out
zsh $c 'iteration=$(dirname "$(ls -t coherence/runs/*/*/pr.md | head -1)")
echo $iteration
cat $iteration/pr.md
git -C "$(jq -r .workspace.path $iteration/iteration.json)" show --stat'
export iteration=$(dirname "$(ls -t coherence/runs/*/*/pr.md | head -1)")
print -r -- "# The next commands reuse \$iteration=$iteration from the block above." >> $out
zsh $c 'bun coherence/loop/propose.ts --iteration $iteration --summary $iteration/summary.md'

print -r -- $'\n## 7. Open your first draft pull request' >> $out
print -r -- "# The exception: this command would push to Silthus/posthog and open a draft on PostHog/posthog, which is Michael's call." >> $out
print -r -- "# It ran exactly as written, but with fakes first on PATH: a git that logs \"push\" and forwards everything else to /usr/bin/git, and a gh that logs its arguments and prints a placeholder URL." >> $out
FAKE=1 zsh $c 'bun coherence/loop/propose.ts --iteration $iteration --summary $iteration/summary.md --draft'
zsh $c 'jq .proposal $iteration/iteration.json'
zsh $c 'gh pr list --repo PostHog/posthog --author @me --draft'
print -r -- "# Restore the dry-run state (pr.md footer and iteration.json) with the re-render command from step 6:" >> $out
zsh $c 'bun coherence/loop/propose.ts --iteration $iteration --summary $iteration/summary.md'

print -r -- $'\n## 8. Answer inbox questions' >> $out
zsh $c 'bun coherence/inbox.ts list'
print -r -- "# resolve answers Michael's questions, so it ran only against the fake gh, with stand-in values for <number> and the answer." >> $out
FAKE=1 zsh $c 'bun coherence/inbox.ts resolve 82 --answer "<option and detail>"'
FAKE=1 zsh $c 'bun coherence/inbox.ts resolve 83 --skip'

print -r -- $'\n## 9. Tune it' >> $out
zsh $c 'bun coherence/targets.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master --posthog-signals coherence/signals/reports/workflows-ci-2026-09-26.json --active-days 3 | head -20'
print -r -- $'\n# done' >> $out
