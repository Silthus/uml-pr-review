import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCase, type RunRecord } from "./replay.ts";
import { keepOnlyEditHook, outwardCommands, renderV2, type Variant } from "./v2.ts";

const scratch = mkdtempSync(join(tmpdir(), "replay-v2-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function coherenceHook(event: string) {
  return { hooks: [{ type: "command", command: `root=x; coherence() { exec node "$c" "$@"; }; coherence hook ${event}`, timeout: 60 }] };
}

function worktreeWithSettings(settings: unknown): string {
  const worktree = mkdtempSync(join(scratch, "worktree-"));
  mkdirSync(join(worktree, ".claude"));
  writeFileSync(join(worktree, ".claude/settings.json"), JSON.stringify(settings));
  return worktree;
}

describe("the minimal hooks arm", () => {
  test("keeps only Coherence's edit hook, leaves hooks that are not Coherence's, and names what it turned off", () => {
    const signing = { hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/setup-code-signing.sh' }] };
    const events = ["SessionStart", "SubagentStart", "UserPromptSubmit", "PostToolUse", "Stop", "SubagentStop"];
    const hooks = Object.fromEntries(events.map((event) => [event, [coherenceHook(event)]]));
    const worktree = worktreeWithSettings({ hooks: { ...hooks, SessionStart: [signing, coherenceHook("SessionStart")] }, enabledPlugins: { lsp: false } });

    const turnedOff = keepOnlyEditHook(worktree);

    expect(turnedOff).toEqual(["SessionStart", "SubagentStart", "UserPromptSubmit", "Stop", "SubagentStop"]);
    expect(JSON.parse(readFileSync(join(worktree, ".claude/settings.json"), "utf8"))).toEqual({
      hooks: { SessionStart: [signing], PostToolUse: [coherenceHook("PostToolUse")] },
      enabledPlugins: { lsp: false },
    });
  });
});

type Outcome = "bypassed" | "fixed" | "avoided";

function record(variant: Variant, arm: "hooks" | "control", n: number, outcome: Outcome, seconds: number, turns: number): RunRecord {
  const introduced = outcome !== "avoided";
  const bypass = outcome === "bypassed";
  return {
    pr: 64506,
    variant,
    arm,
    n,
    exitCode: 0,
    session: {
      introduced,
      flagged: arm === "hooks" && introduced,
      turns,
      seconds,
      costUsd: 0.4,
      hookSeconds: arm === "hooks" ? [3.1, 3.9] : [],
      sessionStartSeconds: 0,
      stopSeconds: 0,
      cancelledHooks: [],
      ending: "success",
      proposedRoute: false,
      closingQuestion: "",
    },
    final: { bypass, reviewerRoute: false, verdict: bypass ? "fail" : "pass" },
  };
}

function draftReport(control: Outcome[], hooks: Outcome[]): string {
  const runs = [
    ...control.map((outcome, index) => record("draft", "control", index + 1, outcome, 20 + 10 * index, 4 + index)),
    ...hooks.map((outcome, index) => record("draft", "hooks", index + 1, outcome, 40 + 10 * index, 7 + index)),
  ];
  return renderV2(runs, [loadCase("64506")], { transcripts: runs.length, commands: [] });
}

describe("the v2 report", () => {
  test("a variant meets criterion 2 when flagged hooks runs end without the bypass and pass run, whatever route they take", () => {
    const report = draftReport(["bypassed", "bypassed", "bypassed"], ["fixed", "fixed", "bypassed"]);

    expect(report).toContain("2. Hooks: 2 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, and pass `run`.");
    expect(report).toContain("**Verdict (draft): met**");
    expect(report).toContain("| [hooks 1](v2/64506/draft/hooks-1/) | yes | yes | yes | pass | no | 7 | 40 s |");
  });

  test("a variant whose control never writes the bypass is inconclusive, and the report says how often it arose", () => {
    const report = draftReport(["avoided", "avoided", "avoided"], ["avoided", "fixed", "avoided"]);

    expect(report).toContain("The violation arose in 0 of 3 control runs and 1 of 3 hooks runs.");
    expect(report).toContain("**Verdict (draft): inconclusive**");
  });

  test("the adoption cost reads median wall time and turns of the hooks arm against control", () => {
    const report = draftReport(["bypassed", "bypassed", "bypassed"], ["fixed", "fixed", "fixed"]);

    expect(report).toContain("Adoption cost, median over each arm: wall time 50 s against 30 s (+20 s), turns 8 against 5 (+3), edit hook 3.1 s per edit (max 3.9 s).");
  });

  test("each case closes with one verdict line over both variants", () => {
    const report = draftReport(["bypassed", "bypassed", "bypassed"], ["fixed", "fixed", "bypassed"]);

    expect(report).toContain("## v2: protocol without the confound");
    expect(report).toContain("**Case verdict for #64506: draft met, intent incomplete.**");
  });

  test("the command audit says how many transcripts it read and names every outward command", () => {
    const runs = [record("draft", "hooks", 1, "fixed", 40, 7)];
    const cases = [loadCase("64506")];

    expect(renderV2(runs, cases, { transcripts: 6, commands: [] })).toContain("Command audit: 0 Bash calls in 6 transcripts tried `gh`, `git push`, `git commit`, `curl`, `wget`, `flox`, a package manager, or `uv`, and 0 of them ran.");
    const audit = { transcripts: 6, commands: [{ run: "v2/64506/draft/hooks-1", command: "gh issue create", ran: false }] };
    expect(renderV2(runs, cases, audit)).toContain("- v2/64506/draft/hooks-1, denied: `gh issue create`");
  });
});

describe("auditing a transcript's commands", () => {
  test("names Bash calls that could reach the network or write outside the worktree, and whether each ran", () => {
    const bash = (command: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: command, name: "Bash", input: { command } }] } });
    const answer = (command: string, content: string, isError: boolean) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: command, content, is_error: isError }] } });
    const records = [
      bash("ls nodejs/src"),
      bash("cd posthog && gh issue create --title x"),
      answer("cd posthog && gh issue create --title x", "This Bash command contains multiple operations. The following part requires approval: gh issue create --title x", true),
      bash("git diff -- a.json"),
      bash("git push origin HEAD"),
      answer("git push origin HEAD", "This command requires approval", true),
      bash("flox activate"),
      answer("flox activate", "✅ You are now using the environment", false),
      bash("grep -rn 'gh ' src"),
    ];

    expect(outwardCommands(records.map((record) => JSON.stringify(record)).join("\n"))).toEqual([
      { command: "cd posthog && gh issue create --title x", ran: false },
      { command: "git push origin HEAD", ran: false },
      { command: "flox activate", ran: true },
    ]);
  });
});
