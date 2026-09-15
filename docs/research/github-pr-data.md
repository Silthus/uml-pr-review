# GitHub pull request data and head checkout through gh

## Summary

1. Use `gh api repos/{owner}/{repo}/pulls/{number}/files --paginate` to get the touched files and the head-side line ranges. Do not use `gh pr view --json files`.
2. `gh pr view --json files` stops at 100 files, and it gives no rename origin and no patch text ([1], [2]).
3. Read the head-side range from each `@@ -a,b +c,d @@` header in the `patch` field. The head-side range starts at line `c` and holds `d` lines ([3]).
4. Fetch `refs/pull/{number}/head` from the base repository. This ref resolves for fork branches, for closed pull requests, for deleted branches, and for deleted forks ([4], verified).
5. Make the checkout with `git worktree add --detach <tmpdir> <headSha>`, and remove it with `git worktree remove --force <tmpdir>` ([5]).

**Recommendation**: get metadata from `gh api repos/{o}/{r}/pulls/{n}`, get touched files and hunks from `gh api repos/{o}/{r}/pulls/{n}/files --paginate --slurp`, and get the head tree from `git fetch origin pull/{n}/head:refs/uml-pr-review/pr/{n}` plus a detached worktree in a temp directory.

---

## 1. Parse a pull request URL

The `gh` CLI holds the reference parser. It uses this regular expression on the URL path ([1], `pkg/cmd/pr/shared/finder.go`):

```
^/([^/]+)/([^/]+)/pull/(\d+)(.*$)
```

Group 4 is the tail. `gh` captures the tail and then discards it. Go's `net/url.Parse` removes the `#fragment` before `gh` reads `.Path`.

Use the same rule. Parse the URL with `new URL()`. Read `url.pathname`. Apply the regular expression. Take group 1 as owner, group 2 as repo, and group 3 as the number.

This rule accepts all the forms that GitHub makes:

| URL | Result |
| --- | --- |
| `https://github.com/O/R/pull/4983` | O, R, 4983 |
| `https://github.com/O/R/pull/4983/files` | O, R, 4983 |
| `https://github.com/O/R/pull/4983/commits` | O, R, 4983 |
| `https://github.com/O/R/pull/4983/` | O, R, 4983 |
| `https://github.com/O/R/pull/4983#discussion_r123456` | O, R, 4983 |

Verified. All five forms gave `{"number":4983}` from `gh pr view <url> --json number,state`.

Also check the host. Accept `github.com` and `www.github.com`. A different host is a GitHub Enterprise Server host, and it needs a different API base URL.

Strip a trailing `.git` from the repo name. GitHub does not make such URLs, but users paste them.

## 2. Head SHA, base SHA, head repository, and changed files

### Metadata

Use the REST endpoint. One request gives every field:

```sh
gh api repos/{owner}/{repo}/pulls/{number}
```

Use these JSON fields ([6]):

| Field | Use |
| --- | --- |
| `head.sha` | The commit to check out. |
| `base.sha` | The commit the pull request starts from. |
| `head.repo.full_name` | The head repository. It is `null` if the fork is deleted. |
| `head.label` | `owner:branch`. It is `null` if the fork is deleted. |
| `base.repo.full_name` | The base repository. It always exists. |
| `merge_commit_sha` | The merge commit, if the pull request is merged. |
| `changed_files` | The true count of touched files. |
| `state`, `merged` | The state of the pull request. |

The pull request comes from a fork when `head.repo.full_name` is not equal to `base.repo.full_name`. The `gh` GraphQL field `isCrossRepository` gives the same answer ([7]).

`gh pr view --json baseRefOid,headRefOid` returns the same two SHAs as `base.sha` and `head.sha`. Verified on PR `Omni-GM/lonir#4983`. Both sources gave head `0cc16e65...` and base `a3045909...`.

### Changed files

Two sources exist. They are not equal.

**Source A, `gh pr view <n> --json files`.** Do not use this source. The `gh` query builder asks for `files(first: 100)`, and `gh` does not page it ([2], `api/query_builder.go`):

```go
var prFiles = shortenQuery(`
	files(first: 100) {
		nodes {
			additions,
			deletions,
			path,
			changeType
		}
	}
`)
```

The Go type holds only four fields ([8], `api/queries_pr.go`):

```go
type PullRequestFile struct {
	Path       string `json:"path"`
	Additions  int    `json:"additions"`
	Deletions  int    `json:"deletions"`
	ChangeType string `json:"changeType"`
}
```

This source gives no rename origin and no patch text. It also truncates, and it gives no warning. Verified:

| Pull request | `changedFiles` | Length of `files` |
| --- | --- | --- |
| `Omni-GM/lonir#4747` | 109 | 100 |
| `Omni-GM/lonir#4597` | 102 | 100 |
| `Omni-GM/lonir#4796` | 90 | 90 |

The cut happens above 100 files. The command still exits 0.

**Source B, the files endpoint.** Use this source:

```sh
gh api --paginate --slurp 'repos/{owner}/{repo}/pulls/{number}/files?per_page=100' | jq '[.[][]]'
```

Each entry is a `diff-entry` object. Use these fields ([9]):

| Field | Use |
| --- | --- |
| `filename` | The head-side path. For a delete, it is the base-side path. |
| `status` | The kind of change. |
| `previous_filename` | The old path. It appears only for `renamed` and `copied`. |
| `additions`, `deletions`, `changes` | Line counts. |
| `patch` | The unified diff for this file. |
| `sha` | The blob SHA on the head side. |

The `status` values are `added`, `removed`, `modified`, `renamed`, `copied`, `changed`, and `unchanged` ([9]). Note the word. A deleted file has the status `removed`, not `deleted`. Verified on `Omni-GM/lonir#4958`, which returned 8 `added`, 20 `modified`, and 1 `removed`.

A rename gives both paths. Verified on `Omni-GM/lonir#4933`:

```json
{
  "filename": "apps/web/src/components/shell-bar/ShellBarAddress.test.tsx",
  "previous_filename": "apps/web/src/features/canvas-first/home/WhereYouAreBand.test.tsx",
  "status": "renamed",
  "additions": 47,
  "deletions": 55,
  "changes": 102
}
```

Use `filename` for the head side. Use `previous_filename` to link the file to its old path in the graph.

The GraphQL enum uses different words. `PatchStatus` holds `ADDED`, `DELETED`, `RENAMED`, `COPIED`, `MODIFIED`, and `CHANGED` ([7]). Map them if you ever read both:

| REST `status` | GraphQL `changeType` |
| --- | --- |
| `added` | `ADDED` |
| `removed` | `DELETED` |
| `modified` | `MODIFIED` |
| `renamed` | `RENAMED` |
| `copied` | `COPIED` |
| `changed` | `CHANGED` |

### Pagination and limits

The files endpoint returns 30 items by default. The maximum `per_page` value is 100 ([9]).

The endpoint has a hard cap: "Responses include a maximum of 3000 files. The paginated response returns 30 files per page by default." ([9]). A pull request with more than 3000 touched files gives an incomplete list. Compare the length of your list against `changed_files` from the metadata call. Warn the user when the two counts differ.

The response holds a `Link` header. Verified on `Omni-GM/lonir#4747`:

```
Link: <https://api.github.com/repositories/1227729810/pulls/4747/files?per_page=100&page=2>; rel="next", <...page=2>; rel="last"
```

`gh api --paginate` requests all pages ([10]). Two traps exist:

- `--paginate` with `--jq` runs the jq program on each page. It does not run it on the joined result. Verified: `gh api --paginate 'repos/Omni-GM/lonir/pulls/4747/files?per_page=100' --jq 'length'` printed `100` and then `9`.
- `--slurp` wraps the pages in an outer array ([10]). `gh` rejects `--slurp` together with `--jq`. Pipe the output to a separate `jq` process.

A 3000-file pull request needs 30 requests at `per_page=100`.

### When the patch field is missing

The `patch` field is not always present. GitHub documents the rule for the patch media type: "Diffs with binary data will have no patch property. Larger diffs may time out and return a 5xx status code." ([11]).

So treat `patch` as optional. A binary file has no `patch`. Skip such files. They hold no symbols.

Verified on binary files. `Omni-GM/lonir#3990` adds 21 PNG and GIF files. Each one returns `status: "added"`, `additions: 0`, `deletions: 0`, `changes: 0`, and no `patch` key:

```sh
gh api repos/Omni-GM/lonir/pulls/3990/files --paginate \
  --jq '.[] | select(.filename|test("\\.(png|gif)$")) | {filename, status, changes, has_patch: has("patch")}'
```

A binary file therefore shows `changes: 0`. Use that as a second check.

Verified that `patch` survives large text diffs. The largest patch found was 35284 characters, for an 827-line change in `Omni-GM/lonir#4957`. No text file lost its `patch`, and no `patch` was cut short. GitHub documents no line limit for this field. Only the binary rule is documented ([11]).

## 3. Per-file hunks and head-side line ranges

### Which source

Two sources give hunks.

**`gh pr diff <n>`** runs `GET repos/{owner}/{repo}/pulls/{number}` with the header `Accept: application/vnd.github.v3.diff` ([12], `pkg/cmd/pr/diff/diff.go`):

```go
acceptType := "application/vnd.github.v3.diff"
if asPatch { acceptType = "application/vnd.github.v3.patch" }
```

It returns one unified diff for the whole pull request. `gh` does not page it, because the endpoint does not page.

**The `patch` field** of each entry from the files endpoint gives the same hunks, but already split by file.

**Use the `patch` field.** Four reasons:

1. It comes with the file list. You make no extra request.
2. It is already split by file. You do not parse `diff --git a/... b/...` headers to find file boundaries.
3. It pages. A very large diff still arrives, in 100-file pages.
4. The diff media type has no paging. GitHub warns that "Larger diffs may time out and return a 5xx status code." ([11]).

The two sources agree. Verified on `Omni-GM/lonir#4957`. The hunk header for `packages/backend/convex/importRuns.ledger-contract.test.ts` is `@@ -0,0 +1,827 @@` in the `patch` field, and it is the same in the `gh pr diff 4957` output. The file counts also agree. `gh pr diff 4957` holds 35 `diff --git` lines, and the files endpoint returns 35 entries. Neither source held a file the other missed.

Keep `gh pr diff` only as a manual debug aid.

### The parsing rule for the head side

Each hunk header has this shape ([3]):

```
@@ -<oldStart>[,<oldCount>] +<newStart>[,<newCount>] @@ [section heading]
```

Match it with this regular expression:

```
/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
```

Apply these rules:

- The head-side start is group 3. Call it `newStart`.
- The head-side count is group 4. Call it `newCount`.
- When the comma and the count are absent, the count is 1. The specification states: "If a hunk contains just one line, only its start line number appears. Otherwise its line numbers look like 'start,count'." ([3]).
- The head-side range is `newStart` to `newStart + newCount - 1`, inclusive.
- When `newCount` is 0, the hunk adds no line on the head side. It is a pure delete. "An empty hunk is considered to start at the line that follows the hunk." ([3]). Anchor the delete at head line `newStart`, and add no range.

Verified. A new file gives `@@ -0,0 +1,122 @@` in `Omni-GM/lonir#4957`. A small edit gives `@@ -111,7 +111,7 @@` in `Omni-GM/lonir#4983`.

### Exact touched lines, not just the hunk range

The hunk range holds context lines too. The default context is 3 lines ([13]). A range of 7 lines can hold only 1 changed line. That is too wide for a symbol match.

Walk the hunk body to get the exact head lines. Set a cursor to `newStart`. Then read each line after the header:

| First character | Action |
| --- | --- |
| `' '` (space) | Context. Step the cursor by 1. |
| `'+'` | Added. Record the cursor as a touched head line. Step the cursor by 1. |
| `'-'` | Removed. Record the cursor as a delete anchor. Do not step the cursor. |
| `'\'` | The marker `\ No newline at end of file`. Ignore it. |

The `+` and `-` marks have this meaning in the specification ([3]). This walk gives the exact touched head lines. Use those lines to find the touched symbols.

Keep both results. Keep the exact added lines for the symbol match. Keep the hunk range for display.

## 4. Fetch the head and make a detached worktree

### The pull request ref

GitHub holds every pull request head under `refs/pull/{number}/head` on the **base** repository ([4]). The namespace is read-only: "The remote `refs/pull/` namespace is read-only." ([4]).

This ref is not in the default fetch refspec. A clone fetches `+refs/heads/*:refs/remotes/origin/*`. You must name the ref.

**This ref resolves in every hard case.** Verified with `git ls-remote`:

| Case | Example | Result |
| --- | --- | --- |
| Merged, head branch deleted | `Omni-GM/lonir#4983` | Resolves to `0cc16e65...`, equal to `head.sha`. |
| Fork branch, closed | `cli/cli#14448`, `#14419`, `#14398`, `#14396` | All resolve. |
| Fork branch, merged | `cli/cli#14363` | Resolves to `a6cb3e85...`, equal to `head.sha`. |
| Fork repository deleted | `cli/cli#11952`, `#11664`, `#11611`, `#11593`, `#9971`, `#8853` | All resolve, and all match `head.sha`. |

So never add the fork as a remote. Always fetch from the base repository remote. This removes the whole fork problem.

### The commands

```sh
# 1. Fetch the head into a private ref. This does not touch the user's branches.
git fetch --no-tags origin \
  "pull/{number}/head:refs/uml-pr-review/pr/{number}"

# 2. Make a detached worktree in a temp directory.
git worktree add --detach "$TMPDIR/uml-pr-review-{number}" <headSha>

# 3. ... run the analysis in that directory ...

# 4. Remove the worktree.
git worktree remove --force "$TMPDIR/uml-pr-review-{number}"

# 5. Delete the private ref.
git update-ref -d "refs/uml-pr-review/pr/{number}"

# 6. Clean stale records, if step 4 failed.
git worktree prune
```

Notes on each step.

**Step 1.** The short form `pull/{n}/head` resolves to `refs/pull/{n}/head`. A refspec has the form `<src>:<dst>` ([14]). Write the destination into your own namespace, such as `refs/uml-pr-review/pr/{n}`. Do not write into `refs/heads/` and do not write into `refs/remotes/origin/`. Those namespaces belong to the user.

Verified in a fresh clone:

```
$ git fetch --no-tags --depth 1 origin pull/4983/head:refs/uml-pr-review/pr/4983
From https://github.com/Omni-GM/lonir
 * [new ref]         refs/pull/4983/head -> refs/uml-pr-review/pr/4983
```

`--depth 1` works. Use it when the repository is large and the analysis needs only the head tree.

Do not fetch a bare SHA instead. A refspec source "can also be a fully spelled hex object name" ([14]), but the server must allow it. GitHub may refuse. Fetch the ref.

**Step 2.** `git worktree add --detach <path> <commit-ish>` accepts a raw SHA. `--detach` means "detach `HEAD` in the new worktree" ([5]). Without `--detach`, `git worktree add <path>` "automatically creates a new branch whose name is the final component of <path>" ([5]). That would add a branch to the user's repository. Always pass `--detach`.

The new worktree "is linked to the current repository, sharing everything except per-worktree files such as `HEAD`, `index`, etc." ([5]). The user's working tree and current branch do not change.

Verified. After the worktree add, `git worktree list --porcelain` showed:

```
worktree /private/tmp/uplr-research/clone
HEAD 824bd52d175374b0c0db64c7c80cd9f1cd7c138d
branch refs/heads/main

worktree /private/tmp/uplr-research/wt
HEAD 0cc16e6568f3b12f3dbbeed8a59a55b711acdd55
detached
```

The main worktree stayed on `main`.

**Step 4.** Always pass `--force`. The documentation says: "Only clean worktrees (no untracked files and no modification in tracked files) can be removed." ([5]). The analysis can write temp files into the worktree. Verified: after writing one untracked file, plain `git worktree remove` failed with `fatal: ... contains modified or untracked files, use --force to delete it`. With `--force` it succeeded.

**Step 6.** `git worktree prune` removes "worktree information in `$GIT_DIR/worktrees` for worktrees whose working trees are missing" ([5]). Run it if the process died, or if the operating system cleaned the temp directory. Use `--dry-run` to test first.

### Speed

`git worktree add` checks out the whole tree. The test repository has 5274 files, and the checkout took several seconds. Two options make it faster:

- Pass `--depth 1` on the fetch, as above.
- Pass `--no-checkout` to `git worktree add`, then set a sparse checkout. Use this only if the analysis reads a known subset of files.

## 5. Verify that the working directory matches the pull request

Run these two commands:

```sh
git rev-parse --show-toplevel
git ls-remote --get-url origin
```

Use `git ls-remote --get-url`, not `git remote get-url`. It expands "any `url.<base>.insteadOf` config setting ... and exit without talking to the remote" ([15]). A user with an `insteadOf` rule gets the true URL.

Normalize the URL, then compare. These forms all name the same repository. All were verified with real remotes:

| Form | Example |
| --- | --- |
| HTTPS with `.git` | `https://github.com/Omni-GM/lonir.git` |
| HTTPS without `.git` | `https://github.com/Omni-GM/lonir` |
| SCP-like SSH | `git@github.com:Omni-GM/lonir.git` |
| SSH URL | `ssh://git@github.com/Omni-GM/lonir.git` |
| HTTPS with credentials | `https://x-access-token:TOKEN@github.com/Omni-GM/lonir.git` |

Apply these steps:

1. If the URL matches `^[^/]+@([^:]+):(.+)$`, it is the SCP-like form. Take group 1 as the host and group 2 as the path.
2. Otherwise parse it with `new URL()`. Take `url.hostname` as the host. Take `url.pathname` as the path. This drops any user and password.
3. Remove a leading `/` from the path. Remove a trailing `.git`.
4. Split the path on `/`. The first part is the owner. The second part is the repo.
5. Compare the owner and the repo against the pull request, with a case-insensitive compare. GitHub treats owner and repo names as case-insensitive.

Check all remotes, not only `origin`. A contributor often has `origin` as their fork and `upstream` as the base repository. List them with `git remote`. Accept the directory when any remote matches the base repository of the pull request, or matches the head repository.

Fetch from the remote that matches the **base** repository. The `refs/pull/` namespace lives only there ([4]).

## 6. Rate limits and access failures

### Rate limits

| Credential | Primary limit |
| --- | --- |
| Personal access token | "5,000 requests per hour" ([16]) |
| GitHub App installation | "5,000 requests per hour" ([16]) |
| `GITHUB_TOKEN` in Actions | "1,000 requests per hour per repository" ([16]) |
| No token | "60 requests per hour" ([16]) |

Secondary limits also apply. "No more than 100 concurrent requests are allowed." and "No more than 900 points per minute are allowed for REST API endpoints" ([16]).

Verified live. `gh api rate_limit` returned `{"limit":5000,"remaining":4993}` for the core resource, and `{"limit":5000}` for graphql.

Read these response headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-used`, `x-ratelimit-reset`, `x-ratelimit-resource`, and `retry-after` ([16]). "If you exceed your primary rate limit, you will receive a `403` or `429` response." ([16]).

One run of this tool costs few requests. It needs 1 request for the metadata, plus `ceil(changed_files / 100)` requests for the files. The worst case is 31 requests for a 3000-file pull request. The rate limit is not a real risk. Do not build a cache for it.

Do not send the file requests in parallel without a limit. Keep the concurrency low to stay under the secondary limits.

### Private repositories and missing access

GitHub hides repositories that you cannot read. "If you try to use a REST API endpoint without a token or with a token that has insufficient permissions, you will receive a `404 Not Found` or `403 Forbidden` response." ([17]).

So a private repository and a repository that does not exist give the same error. Do not tell the user the repository does not exist. Tell the user that the repository is not found, and that it may be private. Tell the user to run `gh auth status` and `gh auth login`.

Verified error shapes:

| Command | Output | Exit code |
| --- | --- | --- |
| `gh api repos/O/R/pulls/1` | `gh: Not Found (HTTP 404)` | 1 |
| `gh pr view 1 --repo O/R --json headRefOid` | `GraphQL: Could not resolve to a Repository with the name 'O/R'. (repository)` | 1 |
| `gh pr view 999999 --repo Omni-GM/lonir --json headRefOid` | `GraphQL: Could not resolve to a PullRequest with the number of 999999. (repository.pullRequest)` | 1 |
| `git ls-remote https://github.com/O/R.git` | `remote: Repository not found.` | non-zero |

A trap exists. `gh pr view 1 --repo <missing repo> --json number` printed `{"number":1}` and exited 0. `gh` answers the `number` field from the argument, and it makes no API call. Never validate access with `--json number` alone. Ask for a field that needs the API, such as `headRefOid` or `state`.

A private repository needs the `repo` scope on the token. Check the scopes with `gh auth status`. It prints a line such as `Token scopes: 'gist', 'read:org', 'repo', 'workflow'`.

Forks need no extra access. The head commit sits on the base repository under `refs/pull/{n}/head` ([4]). Read access to the base repository is enough. This was verified against pull requests whose fork repository is deleted.

The `git` fetch uses its own credentials, not the `gh` token. Set `GIT_TERMINAL_PROMPT=0` on the fetch. This makes git fail instead of asking for a password in a non-interactive run. Use `gh auth setup-git` to make git use the `gh` credentials.

---

## References

1. gh CLI source, PR reference parser: https://raw.githubusercontent.com/cli/cli/trunk/pkg/cmd/pr/shared/finder.go
2. gh CLI source, GraphQL query builder: https://raw.githubusercontent.com/cli/cli/trunk/api/query_builder.go
3. GNU diffutils manual, Detailed Description of Unified Format: https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html
4. GitHub Docs, Checking out pull requests locally: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally
5. git-worktree manual: https://git-scm.com/docs/git-worktree
6. GitHub REST API, Pull requests: https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28
7. GitHub GraphQL API, Enums (`PatchStatus`): https://docs.github.com/en/graphql/reference/enums
8. gh CLI source, pull request queries: https://raw.githubusercontent.com/cli/cli/trunk/api/queries_pr.go
9. GitHub REST API, List pull requests files: https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests-files
10. gh CLI manual, `gh api`: https://cli.github.com/manual/gh_api
11. GitHub REST API, Compare two commits (media types and size limits): https://docs.github.com/en/rest/commits/commits?apiVersion=2022-11-28#compare-two-commits
12. gh CLI source, `gh pr diff`: https://raw.githubusercontent.com/cli/cli/trunk/pkg/cmd/pr/diff/diff.go
13. git-diff manual (`-U<n>`, extended headers): https://git-scm.com/docs/git-diff
14. git-fetch manual (refspec format): https://git-scm.com/docs/git-fetch
15. git-ls-remote manual (`--get-url`): https://git-scm.com/docs/git-ls-remote
16. GitHub Docs, Rate limits for the REST API: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28
17. GitHub Docs, Authenticating to the REST API: https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api?apiVersion=2022-11-28

All live checks ran read-only against the public repositories `Omni-GM/lonir` and `cli/cli` with `gh` version 2.92.0 and `git` version 2.50.1. The worktree checks ran in a throwaway clone in a temp directory. The clone was deleted after the checks.
