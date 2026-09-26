#!/usr/bin/env bun
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { githubPushGuard, type Invocation } from "../../benchmark/lib/invocation.ts";
import { activePullRequestDays } from "../signals/rank.ts";
import { emit, usageError, wholeNumber } from "./cli.ts";
import { defaultMaxQuestions, defaultRunsDirectory } from "./state.ts";

export type SessionOptions = {
  repository: string;
  scope: string;
  budget: number;
  draft: boolean;
  fetch: boolean;
  signals: string | null;
  model: string;
  runs: string;
  activeDays: number;
  maxQuestions: number;
};

export const sessionModel = "claude-opus-5-5";
export const skillPath = join(import.meta.dir, "..", "..", "skills", "coherence-loop", "SKILL.md");

const usage =
  "Usage: bun coherence/loop/session.ts --repo <path> --scope <path> [--budget <n>] [--draft] [--fetch] [--posthog-signals <file>] [--runs <dir>] [--active-days <n>] [--max-questions <n>] [--model <id>] [--transcript <file>]";
const inheritedEnvironment = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR"];
const ResultEventSchema = z.object({ type: z.literal("result"), result: z.string() });
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
      options.runs,
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

export function sessionPrompt({ repository, scope, budget, draft, fetch, signals, runs, activeDays, maxQuestions }: SessionOptions): string {
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
    `- Sense: pass --runs ${runs} --active-days ${activeDays} --max-questions ${maxQuestions} to sense.`,
    "",
    "End with the target, step, verification class, index delta, and the pr.md path or question URL of each iteration.",
  ].join("\n");
}

const sessionFlags = {
  repo: { type: "string" },
  scope: { type: "string" },
  budget: { type: "string", default: "1" },
  draft: { type: "boolean", default: false },
  fetch: { type: "boolean", default: false },
  "posthog-signals": { type: "string" },
  runs: { type: "string", default: defaultRunsDirectory },
  "active-days": { type: "string", default: String(activePullRequestDays) },
  "max-questions": { type: "string", default: String(defaultMaxQuestions) },
  model: { type: "string", default: sessionModel },
  transcript: { type: "string" },
} as const;

export type SessionRequest = { options: SessionOptions; transcript: string };

export function sessionRequest(args: string[]): SessionRequest {
  const { values } = parseArgs({ args, options: sessionFlags });
  if (!values.repo || !values.scope) usageError(usage);
  const options: SessionOptions = {
    repository: resolve(values.repo),
    scope: values.scope,
    budget: wholeNumber(values.budget, "budget", 1),
    draft: values.draft,
    fetch: values.fetch,
    signals: values["posthog-signals"] === undefined ? null : resolve(values["posthog-signals"]),
    model: values.model,
    runs: resolve(values.runs),
    activeDays: wholeNumber(values["active-days"], "active-days", 1),
    maxQuestions: wholeNumber(values["max-questions"], "max-questions"),
  };
  return { options, transcript: resolve(values.transcript ?? join(tmpdir(), `coherence-session-${Date.now()}.jsonl`)) };
}

async function main(): Promise<void> {
  await emit(async () => {
    const { options, transcript } = sessionRequest(process.argv.slice(2));
    const invocation = sessionInvocation(options, await Bun.file(skillPath).text(), process.env);
    const child = Bun.spawn(invocation.command, { cwd: join(import.meta.dir, "..", ".."), env: invocation.env, stdin: new TextEncoder().encode(invocation.prompt), stdout: Bun.file(transcript), stderr: "inherit" });
    return { transcript, exitCode: await child.exited, result: await finalResult(transcript) };
  });
}

async function finalResult(transcript: string): Promise<string | null> {
  const events = (await Bun.file(transcript).text()).split("\n").filter(Boolean);
  const results = events.flatMap((line) => {
    const parsed = ResultEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? [parsed.data.result] : [];
  });
  return results.at(-1) ?? null;
}

if (import.meta.main) await main();
