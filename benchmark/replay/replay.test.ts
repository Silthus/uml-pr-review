import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { declareCase, loadCase, readSession, renderReport, type RunRecord } from "./replay.ts";

const scratch = mkdtempSync(join(tmpdir(), "replay-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const INGESTION_RULE = ["error", { paths: [{ name: "undici", message: "use request" }], patterns: [{ group: ["../*"], message: "use ~/" }] }];

function typescriptWorktree(): string {
  const worktree = mkdtempSync(join(scratch, "worktree-"));
  write(worktree, "nodejs/.oxlintrc.nodejs.json", JSON.stringify({ rules: {}, overrides: [{ files: ["src/ingestion/**/*.ts"], rules: { "eslint/no-restricted-imports": INGESTION_RULE } }] }));
  return worktree;
}

describe("declaring a case in a worktree", () => {
  test("the TypeScript case writes its spec and bans ~/cdp in ingestion, with tests as the listed residual", () => {
    const worktree = typescriptWorktree();

    declareCase(loadCase("64506"), worktree);

    expect(read(worktree, "nodejs/src/ingestion/Ingestion.spec.md")).toContain('via: lint oxlint:no-restricted-imports matching "~/cdp"');
    const config = JSON.parse(read(worktree, "nodejs/.oxlintrc.nodejs.json"));
    expect(config.overrides).toEqual([
      {
        files: ["src/ingestion/**/*.ts"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [{ name: "undici", message: "use request" }],
              patterns: [
                { group: ["../*"], message: "use ~/" },
                {
                  group: ["~/cdp", "~/cdp/**"],
                  message: "ingestion never reaches cdp (nodejs/src/ingestion/Ingestion.spec.md): do not import ~/cdp from ingestion; depend on the contracts in ~/common.",
                },
              ],
            },
          ],
        },
      },
      { files: ["src/ingestion/**/*.test.ts"], rules: { "eslint/no-restricted-imports": INGESTION_RULE } },
    ]);
  });

  test("the Python case fixes the existing bypasses before it declares the chokepoint", () => {
    const worktree = mkdtempSync(join(scratch, "worktree-"));
    const bypassing = 'from posthog.models.activity_logging.model_activity import is_impersonated_session\n\n"was": is_impersonated_session(request),\n';
    for (const file of ["posthog/event_usage.py", "posthog/api/file_system/file_system_logging.py", "products/signals/backend/views.py"]) write(worktree, file, bypassing);

    declareCase(loadCase("68756"), worktree);

    expect(read(worktree, "products/signals/backend/views.py")).toBe('from posthog.helpers.impersonation import is_impersonated\n\n"was": is_impersonated(request),\n');
    expect(read(worktree, "posthog/helpers/Helpers.spec.md")).toContain("chokepoint: is_impersonated in posthog/helpers/impersonation.py");
  });

  test("PostHog's own SessionStart scripts are dropped from the worktree settings, and Coherence's hooks stay", () => {
    const worktree = typescriptWorktree();
    const coherence = { hooks: [{ type: "command", command: "coherence hook SessionStart", timeout: 60 }] };
    const postToolUse = [{ hooks: [{ type: "command", command: "coherence hook PostToolUse" }] }];
    const posthog = { hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/setup-cloud.sh' }, { type: "command", command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/setup-flox.sh' }] };
    write(worktree, ".claude/settings.json", JSON.stringify({ hooks: { SessionStart: [posthog, coherence], PostToolUse: postToolUse }, enabledPlugins: { lsp: false } }));

    declareCase(loadCase("64506"), worktree);

    expect(JSON.parse(read(worktree, ".claude/settings.json"))).toEqual({ hooks: { SessionStart: [coherence], PostToolUse: postToolUse }, enabledPlugins: { lsp: false } });
  });

  test("a pre-declaration fix that no longer matches the worktree stops the declaration", () => {
    const worktree = mkdtempSync(join(scratch, "worktree-"));
    for (const file of ["posthog/event_usage.py", "posthog/api/file_system/file_system_logging.py", "products/signals/backend/views.py"]) write(worktree, file, "already fixed\n");

    expect(() => declareCase(loadCase("68756"), worktree)).toThrow("posthog/event_usage.py does not contain");
  });
});

const FILE = "/tmp/replay-118-64506-hooks-1/posthog/nodejs/src/ingestion/common/event-pipeline/transformEventStep.ts";
const BYPASSING = "import { HogTransformerService } from '~/cdp/hog-transformations/hog-transformer.service'\n";
const FIXED = "import { HogTransformer } from '~/common/hog-transformations/hog-transformer.interface'\n";
const FLAG = { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "Structural defect revealed at this edit:\n✕ nodejs/src/ingestion/ingestion never reaches cdp — totality oracle" } };

function toolUse(id: string, name: string, input: Record<string, unknown>) {
  return { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } };
}

function hook(subtype: "hook_started" | "hook_response", id: string, received: number, output = "", name = "PostToolUse:Write") {
  const event = name.split(":")[0];
  return { type: "system", subtype, hook_id: id, hook_name: name, hook_event: event, ...(subtype === "hook_response" ? { output, outcome: "success" } : {}), received_ms: received };
}

function transcript(...records: object[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

describe("reading a replay session", () => {
  test("a hooks session that writes the bypass, is flagged by name, and edits it away", () => {
    const session = readSession(
      transcript(
        hook("hook_started", "s", 0, "", "SessionStart:startup"),
        hook("hook_response", "s", 600, "", "SessionStart:startup"),
        toolUse("t1", "Write", { file_path: FILE, content: BYPASSING }),
        hook("hook_started", "h1", 1000),
        hook("hook_response", "h1", 3500, JSON.stringify(FLAG)),
        toolUse("t0", "Bash", { command: "ls" }),
        hook("hook_started", "b", 3600, "", "PostToolUse:Bash"),
        hook("hook_response", "b", 3900, "", "PostToolUse:Bash"),
        toolUse("t2", "Edit", { file_path: FILE, old_string: BYPASSING, new_string: FIXED }),
        hook("hook_started", "h2", 5000, "", "PostToolUse:Edit"),
        hook("hook_response", "h2", 6200, "", "PostToolUse:Edit"),
        hook("hook_started", "e", 7000, "", "Stop"),
        hook("hook_response", "e", 42500, "", "Stop"),
        { type: "result", subtype: "success", num_turns: 4, duration_ms: 42000, total_cost_usd: 0.5, received_ms: 43000 },
      ),
      loadCase("64506"),
    );

    expect(session).toEqual({ introduced: true, flagged: true, turns: 4, seconds: 43, costUsd: 0.5, hookSeconds: [2.5, 1.2], sessionStartSeconds: 0.6, stopSeconds: 35.5, proposedRoute: false });
  });

  test("a flag that fires before the bypass was written does not count as flagging it", () => {
    const session = readSession(
      transcript(
        hook("hook_started", "h0", 100),
        hook("hook_response", "h0", 900, JSON.stringify(FLAG)),
        toolUse("t1", "Write", { file_path: FILE, content: BYPASSING }),
        hook("hook_started", "h1", 1000),
        hook("hook_response", "h1", 2000),
        { type: "result", subtype: "success", num_turns: 2, duration_ms: 9000, total_cost_usd: 0.1, received_ms: 9500 },
      ),
      loadCase("64506"),
    );

    expect(session.introduced).toBe(true);
    expect(session.flagged).toBe(false);
  });

  test("a session that ends by proposing the reviewer's route in its answer, without applying it", () => {
    const answer = { type: "assistant", message: { content: [{ type: "text", text: "I kept your content. Should I switch to `~/common/hog-transformations/hog-transformer.interface`?" }] } };
    const session = readSession(transcript(toolUse("t1", "Write", { file_path: FILE, content: BYPASSING }), answer, { type: "result", num_turns: 2, total_cost_usd: 0.1, received_ms: 900 }), loadCase("64506"));

    expect(session.proposedRoute).toBe(true);
  });

  test("a control session that never writes the file introduced nothing", () => {
    const session = readSession(
      transcript(toolUse("t1", "Write", { file_path: "/tmp/elsewhere.ts", content: BYPASSING }), { type: "result", subtype: "error_max_turns", num_turns: 30, duration_ms: 1000, total_cost_usd: 2, received_ms: 1500 }),
      loadCase("64506"),
    );

    expect(session).toEqual({ introduced: false, flagged: false, turns: 30, seconds: 1.5, costUsd: 2, hookSeconds: [], sessionStartSeconds: 0, stopSeconds: 0, proposedRoute: false });
  });
});

type Outcome = "bypassed" | "fixed" | "flagged-kept" | "avoided";

function record(arm: "hooks" | "control", n: number, outcome: Outcome): RunRecord {
  const introduced = outcome !== "avoided";
  const bypass = outcome === "bypassed" || outcome === "flagged-kept";
  return {
    pr: 64506,
    arm,
    n,
    exitCode: 0,
    session: { introduced, flagged: arm === "hooks" && introduced, turns: 5, seconds: 61.24, costUsd: 0.4, hookSeconds: arm === "hooks" ? [2.1, 3.9, 2.5] : [], sessionStartSeconds: arm === "hooks" ? 60.2 : 0, stopSeconds: arm === "hooks" ? 51.73 : 0, proposedRoute: outcome === "flagged-kept" },
    final: { bypass, reviewerRoute: outcome === "fixed", verdict: bypass ? "fail" : "pass" },
  };
}

function reportFor(control: Outcome[], hooks: Outcome[]): string {
  return renderReport([...control.map((outcome, index) => record("control", index + 1, outcome)), ...hooks.map((outcome, index) => record("hooks", index + 1, outcome))], [loadCase("64506")]);
}

describe("the replay report", () => {
  test("a case meets the criteria when at least two control runs keep the bypass and two hooks runs fix it the reviewer's way", () => {
    const report = reportFor(["bypassed", "bypassed", "avoided"], ["fixed", "fixed", "flagged-kept"]);

    expect(report).toContain("1. Control: 2 of 3 runs");
    expect(report).toContain("2. Hooks: 2 of 3 runs");
    expect(report).toContain("**Verdict: met**");
    expect(report).toContain("- The case runs at PostHog master");
    expect(report).toContain("| [hooks 1](64506/hooks-1/) | yes | yes | yes | pass | yes | 5 | 61 s | 2.5 s (max 3.9 s) | 60.2 s / 51.7 s | [transcript](64506/hooks-1/transcript.jsonl), [hooks](64506/hooks-1/hooks.jsonl), [diff](64506/hooks-1/final.diff), [run --status](64506/hooks-1/run-status.txt), [lint](64506/hooks-1/lint.txt), [witness](64506/hooks-1/witness.txt) |");
  });

  test("hooks runs that are flagged but keep the bypass do not meet the criteria", () => {
    const report = reportFor(["bypassed", "bypassed", "bypassed"], ["flagged-kept", "flagged-kept", "fixed"]);

    expect(report).toContain("2. Hooks: 1 of 3 runs");
    expect(report).toContain("In 2 of 3 hooks runs a hook named the invariant, and the session still ended with the bypass.");
    expect(report).toContain("In 2 of 3 hooks runs the final answer named the reviewer's route, but the file kept the bypass. This is outside the criteria.");
    expect(report).toContain("**Verdict: not met**");
  });

  test("a control arm that avoids the bypass unaided makes the case inconclusive", () => {
    const report = reportFor(["avoided", "avoided", "bypassed"], ["fixed", "fixed", "fixed"]);

    expect(report).toContain("**Verdict: inconclusive**");
  });
});
