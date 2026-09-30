import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCase, type RunRecord, type Variant } from "./replay.ts";
import { auditTranscript, keepOnlyEditHook, renderV2, renderV3 } from "./v2.ts";

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
  return renderV2(runs, [loadCase("64506")], { transcripts: runs.length, calls: 0, ran: 0, notReadOnly: [] });
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

  test("a variant whose hooks runs never write the bypass says criterion 2 was not exercised", () => {
    const report = draftReport(["bypassed", "bypassed", "avoided"], ["avoided", "avoided", "avoided"]);

    expect(report).toContain("**Verdict (draft): not met (criterion 2 not exercised: 0 of 3 hooks runs wrote the bypass)**");
    expect(report).toContain("**Case verdict for #64506: draft not met (criterion 2 not exercised: 0 of 3 hooks runs wrote the bypass), intent incomplete.**");
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

  test("the command audit counts the Bash calls that ran and names each one that is not read-only", () => {
    const runs = [record("draft", "hooks", 1, "fixed", 40, 7)];
    const audit = { transcripts: 24, calls: 301, ran: 198, notReadOnly: [{ run: "v2/64506/draft/hooks-1", command: "sed -i s/a/b/ f.ts" }] };

    const report = renderV2(runs, [loadCase("64506")], audit);

    expect(report).toContain("Command audit: the 24 transcripts made 301 Bash calls, and 198 of them ran. 1 of those that ran is not on the read-only allowlist:");
    expect(report).toContain("- v2/64506/draft/hooks-1: `sed -i s/a/b/ f.ts`");
  });
});

describe("the v3 report", () => {
  test("is its own section on v2's protocol, with the TypeScript case's verdicts and an audit of its own transcripts", () => {
    const runs = [record("draft", "control", 1, "bypassed", 30, 5), record("draft", "hooks", 1, "fixed", 50, 8)].map((run) => ({ ...run, pr: 53044 }));

    const report = renderV3(runs, [loadCase("53044")], { transcripts: 2, calls: 9, ran: 4, notReadOnly: [] });

    expect(report).toStartWith("## v3: a TypeScript case that can fire, at its merge base");
    expect(report).toContain("### #53044: `frontend/src/scenes/notebooks/Notebook/TableMenu.tsx`");
    expect(report).toContain("| [hooks 1](v2/53044/draft/hooks-1/) | yes | yes | yes | pass |");
    expect(report).toContain("Command audit: the 2 transcripts made 9 Bash calls, and 4 of them ran. 0 of those that ran are not on the read-only allowlist.");
    expect(report).not.toContain("## v2: protocol without the confound");
  });
});

function bash(id: string, command: string) {
  return { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } };
}

function answer(id: string, content: string, isError: boolean) {
  return { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } };
}

function ranAll(commands: string[]): string {
  return commands
    .flatMap((command, index) => [bash(`t${index}`, command), answer(`t${index}`, "ok", false)])
    .map((record) => JSON.stringify(record))
    .join("\n");
}

describe("auditing a transcript's Bash calls", () => {
  test("reads, searches, and read-only git that ran pass the allowlist, quoted pipes included", () => {
    const readOnly = [
      "ls nodejs/src",
      'cd nodejs && grep -rn -i "a\\|b" src | head -5; echo ---',
      "sed -n 1,40p f.py 2>&1 | tail -3",
      "git -C .. diff --stat",
      "timeout 300 find . -name '*.ts' | wc -l",
      'for f in src/*.ts; do echo "== $f"; cat $f; done',
    ];

    expect(auditTranscript(ranAll(readOnly))).toEqual({ calls: 6, ran: 6, notReadOnly: [] });
  });

  test("names every call that ran and could write or reach out", () => {
    const risky = ["sed -i s/a/b/ f.ts", "echo x > f.txt", "git -C .. push", 'bash -c "gh pr create"', "cat $(ls)", "cd x&&gh issue list", "python3 - <<'EOF'\nprint(1)\nEOF"];

    expect(auditTranscript(ranAll(risky)).notReadOnly).toEqual(risky);
  });

  test("an error other than a command's own exit code means the harness denied the call, so it did not run", () => {
    const transcript = [
      bash("a", "gh issue create --title x"),
      answer("a", "This command requires approval", true),
      bash("b", "cd posthog && npx tsc --noEmit"),
      answer("b", "This Bash command contains multiple operations. The following parts require approval: cd posthog, npx tsc --noEmit", true),
      bash("c", "python3 - <<'EOF'\nopen('f', 'w')\nEOF"),
      answer("c", "Contains brace with quote character (expansion obfuscation)", true),
      bash("d", "grep -rn nothing src"),
      answer("d", "Exit code 1", true),
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");

    expect(auditTranscript(transcript)).toEqual({ calls: 4, ran: 1, notReadOnly: [] });
  });
});

