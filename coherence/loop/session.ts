#!/usr/bin/env bun
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { githubPushGuard, type Invocation } from "../../benchmark/lib/invocation.ts";
import { emit, usageError, wholeNumber } from "./cli.ts";

export type SessionOptions = { repository: string; scope: string; budget: number; draft: boolean; fetch: boolean; signals: string | null; model: string };

export const sessionModel = "claude-opus-5-5";
export const skillPath = join(import.meta.dir, "..", "..", "skills", "coherence-loop", "SKILL.md");

const usage = "Usage: bun coherence/loop/session.ts --repo <path> --scope <path> [--budget <n>] [--draft] [--fetch] [--posthog-signals <file>] [--model <id>] [--transcript <file>]";
const inheritedEnvironment = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR"];
const agentOutwardTools = ["Bash(git push:*)", "Bash(gh:*)", "Bash(curl:*github.com*)"];

export function sessionInvocation(options: SessionOptions, skill: string, environment: Record<string, string | undefined>): Invocation {
  return {
    command: [
      "claude",
      "-p",
      "--model",
      options.model,
      "--setting-sources",
      "local",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: {} }),
      "--add-dir",
      options.repository,
      "--add-dir",
      tmpdir(),
      "--append-system-prompt",
      skill,
      "--disallowedTools",
      ...agentOutwardTools,
    ],
    prompt: sessionPrompt(options),
    env: {
      ...Object.fromEntries(inheritedEnvironment.flatMap((name) => (environment[name] === undefined ? [] : [[name, environment[name]!]]))),
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      GIT_TERMINAL_PROMPT: "0",
      ...(options.draft ? {} : githubPushGuard),
    },
  };
}

export function sessionPrompt({ repository, scope, budget, draft, fetch, signals }: SessionOptions): string {
  return [
    "Run the coherence loop with the coherence-loop skill in your system prompt.",
    "",
    `- Repository: ${repository}`,
    `- Scope: ${scope}`,
    `- Budget: ${budget} pull request${budget === 1 ? "" : "s"}`,
    draft ? "- Mode: draft. Propose with --draft." : "- Mode: dry run. Propose without --draft.",
    fetch ? "- Base: pass --fetch to sense." : "- Base: the local remote-tracking base, without --fetch. The repository stays read-only apart from the scratch workspace.",
    signals === null
      ? "- Signals: refresh them with coherence/signals/export-ci.md when PostHog MCP tools are available; otherwise pass the newest report for this scope in coherence/signals/reports/."
      : `- Signals: pass --posthog-signals ${signals} to sense.`,
    "",
    "End with the target, step, verification class, index delta, and the pr.md path or question URL of each iteration.",
  ].join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      scope: { type: "string" },
      budget: { type: "string", default: "1" },
      draft: { type: "boolean", default: false },
      fetch: { type: "boolean", default: false },
      "posthog-signals": { type: "string" },
      model: { type: "string", default: sessionModel },
      transcript: { type: "string", default: join(tmpdir(), `coherence-session-${Date.now()}.jsonl`) },
    },
  });
  if (!values.repo || !values.scope) usageError(usage);
  await emit(async () => {
    const options: SessionOptions = {
      repository: resolve(values.repo!),
      scope: values.scope!,
      budget: Math.max(1, wholeNumber(values.budget, "budget")),
      draft: values.draft,
      fetch: values.fetch,
      signals: values["posthog-signals"] === undefined ? null : resolve(values["posthog-signals"]),
      model: values.model,
    };
    const invocation = sessionInvocation(options, await Bun.file(skillPath).text(), process.env);
    const transcript = resolve(values.transcript);
    const child = Bun.spawn(invocation.command, { cwd: join(import.meta.dir, "..", ".."), env: invocation.env, stdin: new TextEncoder().encode(invocation.prompt), stdout: Bun.file(transcript), stderr: "inherit" });
    return { transcript, exitCode: await child.exited, result: await finalResult(transcript) };
  });
}

async function finalResult(transcript: string): Promise<string | null> {
  const events = (await Bun.file(transcript).text()).split("\n").filter(Boolean);
  const result = events.map((line) => JSON.parse(line) as { type?: string; result?: string }).findLast(({ type }) => type === "result");
  return result?.result ?? null;
}

if (import.meta.main) await main();
