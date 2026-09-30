# feat(admin): audit and display who tops up an AI gateway wallet

Admin AI gateway wallet top-ups did not record who performed them, so nobody could answer "who topped up this team" after the fact. This change records a staff-only `AIGatewayCredit` activity log entry per top-up, including whether the staff member was impersonating, and shows recent top-ups on the Team admin page.

In `posthog/admin/admins/team_admin.py`, after a staff member adds AI gateway credit to a team, log an activity with scope `AIGatewayCredit` and activity `credit_added`, keyed by the ledger entry id. It records the acting user, whether they were impersonating, and the amount, reason, and resulting balance. The gateway credit and this record can't share a transaction, so write the record whenever none exists yet for that ledger entry. Then show the team's recent top-ups (when, who, amount, reason) on the Team admin page.

Follow the codebase's conventions. Do not run git.
