// PROTOTYPE - throwaway. Answers issue #13: does a test case work as a Symbol?
//
// Run it with:  bun run prototype/analyzer/run-test-symbols.ts
//
// It reads lonir#4819 through `gh api`, checks the head out into a detached
// worktree under /tmp (never the user's lonir working tree), runs the extended
// tsc extractor and, for a fair before/after, the version of the same file that
// is committed at HEAD~ of this branch. It writes out/graph-tsc-tests.json and
// out/test-symbols.md.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { readPullRequest } from "./touched.ts";
import type { AnalyzeInput, Graph, GraphSymbol } from "./interface.ts";
import { isTestPath } from "./workspace.ts";

const PR_URL = "https://github.com/Omni-GM/lonir/pull/4819";
const CLONE = `${process.env.HOME}/dev/lonir`;
const HERE = dirname(Bun.fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
/** The commit that holds the extractor before test symbols were added. */
const BASELINE_REF = "origin/prototype/analyzer-extractors";

/**
 * Read by hand from the checked out head, not from the tool. This is the known
 * example from issue #5 that the extension is supposed to recover.
 */
const HAND_VERIFIED = {
  file: "packages/backend/convex/chats/sendAction.truncation.test.ts",
  line: 164,
  callee: "turnProducedFinalText",
  evidence:
    "Line 164 reads `expect(turnProducedFinalText(emptySummary)).toBe(false)`. " +
    "It sits inside `it('an empty summary generation does NOT count as a closed turn', ...)` " +
    "(line 161), inside `describe('empty summary generation - turn still closed by the static fallback (AC4, AC12)', ...)` " +
    "(line 155), inside `describe('streamChatResponse - truncation-summary turn (ADR-0159 decision 3)', ...)` (line 106).",
};

async function sh(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    ...(cwd ? { cwd } : {}),
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed:\n${err}`);
  return out + err;
}

/** Run one extractor in its own process so peak RSS is its own. */
async function runExtractor(
  script: string,
  inputPath: string,
  outputPath: string,
): Promise<{ wallMs: number; peakRssMb: number }> {
  const started = Date.now();
  const output = await sh([
    "/usr/bin/time",
    "-l",
    "bun",
    "run",
    script,
    inputPath,
    outputPath,
  ]);
  const wallMs = Date.now() - started;
  const rss = /(\d+)\s+maximum resident set size/.exec(output);
  return {
    wallMs,
    peakRssMb: rss ? Math.round(Number(rss[1]) / 1024 / 1024) : 0,
  };
}

function table(rows: string[][]): string {
  const head = rows[0]!;
  return [head, head.map(() => "---"), ...rows.slice(1)]
    .map((r) => `| ${r.join(" | ")} |`)
    .join("\n");
}

function counterTable(graph: Graph): string {
  return table([
    ["Counter", "Value"],
    ...Object.entries(graph.meta.counters)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => [`\`${k}\``, String(v)]),
  ]);
}

const main = async () => {
  mkdirSync(OUT, { recursive: true });

  const [, owner, repo, num] =
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(PR_URL) ?? [];
  const { pr, touched } = await readPullRequest(owner!, repo!, Number(num));

  const worktree = `/tmp/uml-pr-review-lonir-${pr.number}`;
  const ref = `refs/uml-pr-review/pr/${pr.number}`;
  if (!existsSync(worktree)) {
    await sh([
      "git", "-C", CLONE, "fetch", "--no-tags", "origin",
      `pull/${pr.number}/head:${ref}`,
    ]);
    await sh(["git", "-C", CLONE, "worktree", "add", "--detach", worktree, ref]);
  }
  if (!existsSync(join(worktree, "node_modules"))) {
    console.log("pnpm install in the worktree, this takes a minute");
    await sh(
      ["pnpm", "install", "--frozen-lockfile", "--offline", "--ignore-scripts"],
      worktree,
    ).catch(() => sh(["pnpm", "install", "--ignore-scripts"], worktree));
  }
  console.log(`pr #${pr.number} head ${pr.headSha} worktree ${worktree}`);

  const input: AnalyzeInput = { worktree, touched, hops: 1, pr };
  const inputPath = join(OUT, "input.json");
  await Bun.write(inputPath, `${JSON.stringify(input, null, 2)}\n`);

  // The before side: the same extractor as it stands on the branch this one
  // grew from, run now, on this machine, so the cost numbers are comparable.
  const baselineScript = join(HERE, "baseline-extract-tsc.generated.ts");
  await Bun.write(
    baselineScript,
    await sh(
      ["git", "show", `${BASELINE_REF}:prototype/analyzer/extract-tsc.ts`],
      HERE,
    ),
  );

  const basePath = join(OUT, "graph-tsc-baseline.json");
  const testsPath = join(OUT, "graph-tsc-tests.json");
  const secondPath = join(OUT, "graph-tsc-tests.second.json");

  const baseRun = await runExtractor(baselineScript, inputPath, basePath);
  const testRun = await runExtractor(
    join(HERE, "extract-tsc.ts"),
    inputPath,
    testsPath,
  );
  await runExtractor(join(HERE, "extract-tsc.ts"), inputPath, secondPath);

  const firstBytes = readFileSync(testsPath);
  const secondBytes = readFileSync(secondPath);
  const identical = firstBytes.equals(secondBytes);
  const sha = async (p: string) =>
    (await sh(["shasum", "-a", "256", p])).split(" ")[0]!;
  const shaFirst = await sha(testsPath);
  const shaSecond = await sha(secondPath);
  rmSync(secondPath);
  rmSync(baselineScript);

  const base = JSON.parse(readFileSync(basePath, "utf8")) as Graph;
  const now = JSON.parse(firstBytes.toString()) as Graph;

  const droppedBefore = base.meta.counters.callersAtModuleTopLevel ?? 0;
  const droppedAfter = now.meta.counters.callersAtModuleTopLevel ?? 0;
  const recovered = droppedBefore - droppedAfter;

  const byId = new Map(now.symbols.map((s) => [s.id, s]));
  const isTestSymbol = (s: GraphSymbol | undefined) =>
    s !== undefined && (s.kind === "test" || s.kind === "hook");
  const testEdges = now.edges.filter((e) => isTestSymbol(byId.get(e.from)));
  const testCallerEdges = testEdges.filter(
    (e) => byId.get(e.to)?.touched === true,
  );

  // Which touched symbol now has a test caller, and which tests they are.
  const coverage = new Map<string, string[]>();
  for (const e of testCallerEdges) {
    const list = coverage.get(e.to) ?? [];
    list.push(e.from);
    coverage.set(e.to, list);
  }

  const unattributed = now.meta.notes.filter((n) =>
    n.startsWith("unattributed caller into "),
  );
  const recoveredNotes = now.meta.notes.filter((n) =>
    n.startsWith("recovered caller into "),
  );
  const recoveredByKind = (kind: string) =>
    now.meta.counters[`recovered_${kind}`] ?? 0;

  const testSymbols = now.symbols.filter((s) => s.kind === "test");
  const hookSymbols = now.symbols.filter((s) => s.kind === "hook");

  const md = `# Test cases as symbols in the call graph

> PROTOTYPE OUTPUT. Throwaway. Generated by
> \`bun run prototype/analyzer/run-test-symbols.ts\` on branch
> \`prototype/test-case-symbols\`. Answers issue #13.

## The question

Issue #5 found that the tsc extractor dropped ${droppedBefore} incoming calls on
[lonir#${pr.number}](${pr.url}), because a call inside \`it('...', () => { ... })\`
has no enclosing declaration. Can a test case be a Symbol, so "which test covers
this change" becomes a call edge?

## Headline numbers

${table([
  ["Measure", "Before (#5)", "After (#13)"],
  ["Incoming calls with no enclosing symbol", String(droppedBefore), String(droppedAfter)],
  ["Of the dropped ones, recovered onto a test case", "-", String(recoveredByKind("test"))],
  ["Of the dropped ones, recovered onto a test hook", "-", String(recoveredByKind("hook"))],
  ["Of the dropped ones, recovered onto a production symbol", "-", String(["function", "class", "method", "arrow", "const"].reduce((n, k) => n + recoveredByKind(k), 0))],
  ["Caller edges leaving a test case", "0", String(now.meta.counters.callersThatAreTestCases ?? 0)],
  ["Caller edges leaving a test hook", "0", String(now.meta.counters.callersThatAreTestHooks ?? 0)],
  ["Touched symbols", String(base.symbols.filter((s) => s.touched).length), String(now.symbols.filter((s) => s.touched).length)],
  ["Symbols in graph", String(base.symbols.length), String(now.symbols.length)],
  ["Of those, kind test", "0", String(testSymbols.length)],
  ["Of those, kind hook", "0", String(hookSymbols.length)],
  ["Files in graph", String(base.files.length), String(now.files.length)],
  ["Of those, test files", String(base.files.filter((f) => isTestPath(f.path)).length), String(now.files.filter((f) => f.isTest).length)],
  ["Edges", String(base.edges.length), String(now.edges.length)],
  ["Of those, from a test or hook symbol", "0", String(testEdges.length)],
  ["Wall time", `${(baseRun.wallMs / 1000).toFixed(1)} s`, `${(testRun.wallMs / 1000).toFixed(1)} s`],
  ["Peak RSS", `${baseRun.peakRssMb} MB`, `${testRun.peakRssMb} MB`],
])}

**${recovered} of the ${droppedBefore} dropped incoming calls are recovered.**
${droppedAfter} remain unattributed; they are listed and explained below.

Determinism: two runs of the extended extractor gave byte-identical JSON:
**${identical}**.

\`\`\`
${shaFirst}  run 1
${shaSecond}  run 2
\`\`\`

## Touched symbols that now have a test caller

${
  coverage.size === 0
    ? "None."
    : [...coverage.entries()]
        .sort()
        .map(
          ([to, froms]) =>
            `### \`${to}\`\n\n${froms
              .sort()
              .map((f) => {
                const s = byId.get(f)!;
                return `- ${s.kind} \`${f}\` (${s.fileId}:${s.line.start}-${s.line.end})`;
              })
              .join("\n")}`,
        )
        .join("\n\n")
}

## Hand-verified example

\`${HAND_VERIFIED.file}:${HAND_VERIFIED.line}\` calls \`${HAND_VERIFIED.callee}\`,
which this pull request touches.

${HAND_VERIFIED.evidence}

The extractor now reports:

${
  testCallerEdges
    .filter((e) => byId.get(e.from)?.fileId === HAND_VERIFIED.file)
    .map((e) => `- \`${e.from}\`\n  -[call]-> \`${e.to}\``)
    .join("\n") || "- nothing. The example was NOT recovered."
}

## Where each of the ${droppedBefore} dropped calls went

${recoveredNotes.length === 0 ? "None recovered." : recoveredNotes.map((n) => `- ${n.replace("recovered caller into ", "")}`).sort().join("\n")}

## The ${droppedAfter} incoming calls that are still unattributed

${unattributed.length === 0 ? "None." : unattributed.map((n) => `- ${n.replace("unattributed caller into ", "")}`).join("\n")}

## Decisions locked while building

**The id.** \`<repo-relative path>#test:<describe titles> > <it title>\`. The
describe titles and the test title are joined by \` > \`, the separator a Vitest
reporter prints, so the id reads back as the line a developer already sees in a
test run. A hook uses the prefix \`hook:\` and the hook name in place of a title.

The id is defended on stability: a title is what a human uses to name a test,
and it survives every edit above it in the file. A position-based id
(\`test@164\`) would change on every line inserted higher up, which is most pull
requests. The cost is the opposite case: renaming a test changes its id, and the
graph reads that as a delete plus an add. That is the right reading, because a
renamed test is a renamed thing.

**A describe block is a name prefix, not a Symbol.** It declares nothing, no
code calls it, and a box for it would carry no edge of its own. Its whole value
is the name it lends to the tests below it, and the id carries that already.

**A hook is a Symbol, of kind \`hook\`.** A call inside \`beforeEach\` is made once
per test in the block, so attributing it to a named test case would be a lie.
Giving the hook its own symbol names the setup honestly and lets a renderer say
"the setup of this suite", not "this test".

**\`it.only\`, \`it.skip\`, \`it.concurrent\`, \`it.failing\` keep the id of the plain
test.** A modifier is a run instruction, not part of the identity. Adding
\`.only\` while debugging must not make the graph think a test was deleted and a
new one added.

**\`it.each\` is one symbol for the whole block.** The title is read off the outer
call, placeholders and all (\`adds $a and $b\`). The cases are data and they share
one body, so they share one set of call sites. One symbol is the truthful count.

**A template-literal title keeps its substitution.** \`\\\`renders in \${mode} mode\\\`\`
becomes the id text \`renders in \${mode} mode\`. A non-literal title
(\`it(CASE_TITLE, ...)\`) uses the source text of the expression. Both are stable
across runs and both point a reader at something they can find in the file.

**A test with no body is not a Symbol.** \`it.todo('later')\` and \`it('pending')\`
have no callback, so they can call nothing and can carry no edge.

**Test symbols are on in test files only.** The gate is the file name
(\`.test.\` / \`.spec.\` / \`__tests__/\`), which keeps a production file that
happens to declare a function called \`test\` out of the graph.

**A test symbol is never asked for its incoming calls.** Nothing calls a test
case. Asking the call hierarchy at its position would answer with the callers of
\`it\` across the whole repository.

These shapes are pinned by \`bun test prototype/analyzer/test-shapes.test.ts\`,
because lonir#${pr.number} uses plain \`it\` and \`describe\` only.

## A second bug this uncovered

7 of the recovered call sites are not in a test file at all. They sit inside
\`packages/backend/convex/chats/sendAction.ts#streamChatResponse\`, a convex
\`internalAction({ handler: async () => { ... } })\`. The call hierarchy walks up
from a call to the nearest declaration it recognises; an anonymous handler arrow
is not one, so it reported the source file and the baseline dropped the call.
Attributing by the call site instead of by the call hierarchy item fixes the
convex shape and the \`it(...)\` shape with the same line of code.

## What the Graph must carry

Two fields, and both are needed:

- \`GraphFile.isTest\` answers "is this box a test file". It is enough to tint a
  file and to let a reviewer collapse every test at once.
- \`GraphSymbol.kind: "test" | "hook"\` answers "is this arrow coming from a test
  case or from its setup". The per-file flag cannot answer it, because a test
  file also holds ordinary helper functions: this run put ${now.symbols.filter((s) => s.fileId.includes(".test.")).length} symbols in
  test files, of which ${testSymbols.length} are tests and ${hookSymbols.length} are hooks and the rest are
  plain helpers. A renderer that drew every symbol in a test file as a test case
  would mislabel the helpers, and a renderer that drew only the flag could not
  separate "this test asserts on the change" from "this test's setup happens to
  touch it".

## Counters, extended extractor

${counterTable(now)}

## Counters, baseline extractor

${counterTable(base)}

## Notes recorded by the extended extractor

${now.meta.notes
  .filter(
    (n) =>
      !n.startsWith("unattributed caller into ") &&
      !n.startsWith("recovered caller into "),
  )
  .map((n) => `- ${n}`)
  .join("\n")}
`;

  await Bun.write(join(OUT, "test-symbols.md"), md);
  console.log(
    `recovered ${recovered}/${droppedBefore}; test symbols ${testSymbols.length}; hook symbols ${hookSymbols.length}; identical ${identical}`,
  );
  console.log(`wrote ${join(OUT, "test-symbols.md")}`);
};

await main();
