README check from a fresh clone of implement/posthog-proof (2026-09-26, about 14:50 CEST)

$ git clone --branch implement/posthog-proof <repo> /tmp/wf30/fresh && cd /tmp/wf30/fresh
$ ls node_modules
ls: node_modules: No such file or directory
$ bun install
76 packages installed [940.00ms]
$ bun run start
$ NODE_ENV=production bun run src/server.ts
uml-pr-review is running at http://127.0.0.1:4477/
$ curl -s -o /dev/null -w "/ %{http_code}\n" http://127.0.0.1:4477/
/ 200
$ curl -s -o /dev/null -w "/pulls %{http_code}\n" http://127.0.0.1:4477/pulls
/pulls 200

A headless Claude Opus 5.5 session then called get_architecture_overview on that clone through the server
(scripts/proof/run-agent.sh with a one-server MCP config):
[init] claude 2.1.282, model claude-opus-5-5, session 6a3eac9e-df6e-44e5-bed1-49317ebbad81, mcp servers [uml-pr-review: connected]
>>> get_architecture_overview {"worktree":"/private/tmp/wf30/fresh"}
[assistant] The repository is **fresh**, and its modules are `scripts` and `src`.

The registration commands themselves are proven in readme-claude-register.txt (Claude Code, user scope, in a
throwaway HOME) and readme-codex-exec.txt (Codex, with the README's settings passed as -c overrides).
The server was stopped and the clone removed afterwards.
