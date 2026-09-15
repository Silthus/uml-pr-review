// PROTOTYPE - throwaway. Runs both extractors on one lonir pull request and
// writes out/graph-tsc.json, out/graph-treesitter.json and out/comparison.md.
//
// Run it with:  bun run prototype/analyzer/compare.ts
//
// THE QUESTION THIS ANSWERS (issue #5)
// What is the smallest analyzer interface that a precise TypeScript extractor
// and a syntax-only tree-sitter extractor can both implement, and does the
// syntax-only extractor produce trustworthy edges? The interface is
// interface.ts. The trust answer is out/comparison.md.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { readPullRequest } from "./touched.ts";
import type { AnalyzeInput, Graph, GraphEdge } from "./interface.ts";
import { edgeKey } from "./interface.ts";

const PR_URL = "https://github.com/Omni-GM/lonir/pull/4819";
const CLONE = `${process.env.HOME}/dev/lonir`;
const HERE = dirname(Bun.fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

// The verdicts below were produced by reading the checked out source, not by
// the tools. Each one names the file and line that settles it.
type Verdict = "correct" | "wrong" | "missed";
type Sample = { edge: string; verdict: Verdict; evidence: string };

const TSC_SAMPLE: Sample[] = [
  {
    edge: "chats/lib/noResponseFallback.ts#buildNoResponseFallback -> chats/lib/noResponseFallback.ts#turnSavedAnyResponse",
    verdict: "correct",
    evidence:
      "noResponseFallback.ts:298 reads `if (!turnSavedAnyResponse(savedMessages) && finishReason === undefined)`.",
  },
  {
    edge: "chats/lib/noResponseFallback.ts#buildNoResponseFallback -> chats/lib/savedMessageReaders.ts#turnProducedFinalText",
    verdict: "correct",
    evidence:
      "noResponseFallback.ts:288 calls it; the name comes from `./savedMessageReaders` at line 17.",
  },
  {
    edge: "chats/sendAction.ts#markMessageCutOff -> packages/errors/src/index.ts#createError",
    verdict: "correct",
    evidence:
      "sendAction.ts:498 calls `createError({...})`, imported from the package specifier `@omnigame/errors` at line 10. errors/src/index.ts:40 declares it. This edge only exists because the program was built without projectReferences; with them, `@omnigame/errors` would arrive as dist/*.d.ts.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> skills/buildCatalogSection.ts#buildCatalogSection",
    verdict: "correct",
    evidence:
      "sendAction.ts:731 calls it. The import is `from '../skills'` (line 51), and skills.ts:107 only re-exports it from './skills/buildCatalogSection'. The checker followed the re-export.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> chats/sendAction.ts#markMessageCutOff",
    verdict: "correct",
    evidence: "sendAction.ts:1315 reads `await markMessageCutOff(ctx, cutOff)`.",
  },
  {
    edge: "chats/lib/truncationSummary.ts#shouldFireSummaryTurn -> chats/lib/savedMessageReaders.ts#turnProducedFinalText",
    verdict: "correct",
    evidence:
      "An incoming call. truncationSummary.ts:82 reads `if (turnProducedFinalText(savedMessages)) return false`.",
  },
  {
    edge: "apps/web/src/features/chat/testing.ts#createChatTestHarness -> packages/backend/convex/chats/testing.ts#createChatAgentWithMockModel",
    verdict: "correct",
    evidence:
      "An incoming call across a package boundary and across an app boundary. apps/web/.../testing.ts:87 calls it, imported from '@omnigame/backend/testing/chat' at line 32. Resolved through the package.json exports field.",
  },
  {
    edge: "chats/testing.ts#withRepairedFinishReason.doStream -> chats/testing.ts#repairMockFinishReason",
    verdict: "correct",
    evidence:
      "testing.ts:79 reads `repairMockFinishReason(result.stream)` inside the nested `doStream` arrow, so the edge starts at the nested symbol and not at its parent.",
  },
  {
    edge: "sendAction.faultedTurn.test.ts#sendAndReadThread -> convex/testing.ts#seedConvexWorkspace",
    verdict: "correct",
    evidence:
      "sendAction.faultedTurn.test.ts:69 reads `await seedConvexWorkspace(t)`, imported from './testing' at line 30.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> chats/agent.ts#getChatAgentForWrites",
    verdict: "correct",
    evidence:
      "sendAction.ts:580 reads `const agent = getChatAgentForWrites()`. Declared in agent.ts, imported from './agent' at line 18.",
  },
];

const TREESITTER_SAMPLE: Sample[] = [
  {
    edge: "chats/lib/noResponseFallback.ts#buildNoResponseFallback -> chats/lib/noResponseFallback.ts#turnSavedAnyResponse",
    verdict: "correct",
    evidence:
      "Same file, so the name matched locally. No import and no type needed.",
  },
  {
    edge: "chats/lib/noResponseFallback.ts#buildNoResponseFallback -> chats/lib/savedMessageReaders.ts#turnProducedFinalText",
    verdict: "correct",
    evidence:
      "The specifier './savedMessageReaders' resolved on disk, and the name is declared in that file.",
  },
  {
    edge: "chats/sendAction.ts#markMessageCutOff -> packages/errors/src/index.ts#createError",
    verdict: "correct",
    evidence:
      "Right by luck. The specifier '@omnigame/errors' cannot be resolved lexically, so the extractor fell back to every symbol named createError in the repository. Exactly one exists. Had a second file declared a createError, this would have produced two edges and one of them would be false.",
  },
  {
    edge: "apps/web/src/features/chat/testing.ts#createChatTestHarness -> packages/backend/convex/chats/testing.ts#createChatAgentWithMockModel",
    verdict: "correct",
    evidence:
      "Right by luck, same route. '@omnigame/backend/testing/chat' is a subpath export that only package.json can resolve. The name is unique in the repository, so the global fallback landed on the one true target.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> skills/buildCatalogSection.ts#buildCatalogSection",
    verdict: "missed",
    evidence:
      "The import is `from '../skills'`. That resolves on disk to convex/skills.ts, which is a barrel: line 107 re-exports buildCatalogSection from './skills/buildCatalogSection' and declares nothing. Lexical resolution stops at the barrel, so no edge at all.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> skills/perTurnCatalog.ts#buildPerTurnCatalog",
    verdict: "missed",
    evidence: "Same barrel. skills.ts:78 re-exports it from './skills/perTurnCatalog'.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> skills/stance/resolveStance.ts#resolveStanceForSlug",
    verdict: "missed",
    evidence: "Same barrel. skills.ts:139 re-exports it from './skills/stance/resolveStance'.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> skills/stance/resolveStance.ts#stanceFlagKeyForSlug",
    verdict: "missed",
    evidence: "Same barrel, same re-export block.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> chats/agent/buildProviderOptions.ts#buildProviderOptions",
    verdict: "missed",
    evidence:
      "The import is `from './agent'`, which resolves to agent.ts. agent.ts:97 re-exports buildProviderOptions from './agent/buildProviderOptions'. Note that the same import statement also names getChatAgentForWrites, which IS declared in agent.ts, so one import statement is half seen and half blind.",
  },
  {
    edge: "chats/sendAction.ts#streamChatResponse -> chats/systemPrompt/outputLanguage.ts#buildOutputLanguageSection",
    verdict: "missed",
    evidence:
      "Same shape as the one above. `from './systemPrompt'` resolves to systemPrompt.ts, which declares buildSystemPrompt (found) and re-exports buildOutputLanguageSection (missed).",
  },
];

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
    join(HERE, script),
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
  const sep = head.map(() => "---");
  return [head, sep, ...rows.slice(1)]
    .map((r) => `| ${r.join(" | ")} |`)
    .join("\n");
}

function sampleTable(samples: Sample[]): string {
  return samples
    .map(
      (s, i) =>
        `${i + 1}. \`${s.edge}\` - **${s.verdict}**. ${s.evidence}`,
    )
    .join("\n");
}

function counterTable(graph: Graph): string {
  const rows = Object.entries(graph.meta.counters)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => [`\`${k}\``, String(v)]);
  return table([["Counter", "Value"], ...rows]);
}

const main = async () => {
  mkdirSync(OUT, { recursive: true });

  const [, owner, repo, num] =
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(PR_URL) ?? [];
  const { pr, touched } = await readPullRequest(owner!, repo!, Number(num));
  console.log(`pr #${pr.number} head ${pr.headSha} files ${touched.length}`);

  // Check out the head into a detached worktree. Never touch the user's tree.
  const worktree = `/tmp/uml-pr-review-lonir-${pr.number}`;
  const ref = `refs/uml-pr-review/pr/${pr.number}`;
  if (!existsSync(worktree)) {
    await sh(["git", "-C", CLONE, "fetch", "--no-tags", "origin", `pull/${pr.number}/head:${ref}`]);
    await sh(["git", "-C", CLONE, "worktree", "add", "--detach", worktree, ref]);
    console.log("running pnpm install in the worktree, this takes a minute");
    await sh(
      ["pnpm", "install", "--frozen-lockfile", "--offline", "--ignore-scripts"],
      worktree,
    ).catch(() => sh(["pnpm", "install", "--ignore-scripts"], worktree));
  }
  console.log(`worktree ${worktree}`);

  const input: AnalyzeInput = { worktree, touched, hops: 1, pr };
  const inputPath = join(OUT, "input.json");
  await Bun.write(inputPath, `${JSON.stringify(input, null, 2)}\n`);

  const tscPath = join(OUT, "graph-tsc.json");
  const tsPath = join(OUT, "graph-treesitter.json");

  const tscRun = await runExtractor("extract-tsc.ts", inputPath, tscPath);
  const tsRun = await runExtractor("extract-treesitter.ts", inputPath, tsPath);

  // Determinism: run the tsc extractor a second time and compare bytes.
  const secondPath = join(OUT, "graph-tsc.second.json");
  await runExtractor("extract-tsc.ts", inputPath, secondPath);
  const first = readFileSync(tscPath);
  const second = readFileSync(secondPath);
  const identical = first.equals(second);
  console.log(`byte-identical across two tsc runs: ${identical}`);
  rmSync(secondPath);

  const tsc = JSON.parse(first.toString()) as Graph;
  const tree = JSON.parse(readFileSync(tsPath, "utf8")) as Graph;

  const keys = (g: Graph) => new Set(g.edges.map(edgeKey));
  const A = keys(tsc);
  const B = keys(tree);
  const onlyA = [...A].filter((k) => !B.has(k)).sort();
  const onlyB = [...B].filter((k) => !A.has(k)).sort();
  const shared = [...A].filter((k) => B.has(k)).length;

  const touchedIds = new Set(
    tsc.symbols.filter((s) => s.touched).map((s) => s.id),
  );
  const isCallee = (e: GraphEdge) => touchedIds.has(e.from);
  const split = (g: Graph) => ({
    callee: g.edges.filter(isCallee).length,
    caller: g.edges.filter((e) => !isCallee(e)).length,
  });
  const sa = split(tsc);
  const sb = split(tree);

  const perFile = [...new Set([...tsc.files, ...tree.files].map((f) => f.path))]
    .sort()
    .map((path) => {
      const file =
        tsc.files.find((f) => f.path === path) ??
        tree.files.find((f) => f.path === path)!;
      const a = tsc.symbols.filter((s) => s.fileId === path);
      const b = tree.symbols.filter((s) => s.fileId === path);
      return [
        `\`${path}\``,
        file.status,
        String(a.length),
        String(b.length),
        String(a.filter((s) => s.touched).length),
        String(b.filter((s) => s.touched).length),
      ];
    });

  const md = `# Analyzer comparison: precise tsc against syntax-only tree-sitter

> PROTOTYPE OUTPUT. Throwaway. Generated by \`bun run prototype/analyzer/compare.ts\`.

## The question

Issue #5 asks two things. What is the smallest analyzer interface that a
precise TypeScript extractor and a syntax-only tree-sitter extractor can both
implement, and how large is the trust gap between their call edges on a real
lonir pull request?

The interface is \`prototype/analyzer/interface.ts\`. It is one function:

\`\`\`ts
type Analyzer = (input: {
  worktree: string;
  touched: TouchedFile[];
  hops: number;
  pr: PullRequestRef;
}) => Promise<Graph>;
\`\`\`

Both extractors implement exactly that and share nothing else but file
discovery. So the interface holds.

## The pull request

${table([
  ["Field", "Value"],
  ["Pull request", `[#${pr.number}](${pr.url})`],
  ["Title", pr.title],
  ["Head", `\`${pr.headSha}\``],
  ["Touched files", String(touched.length)],
  ["Touched head lines", String(touched.reduce((n, f) => n + f.touchedLines.length, 0))],
])}

## Headline numbers

${table([
  ["Measure", "tsc", "tree-sitter"],
  ["Workspace source files read", String(tsc.meta.counters.workspaceFiles ?? 0), String(tree.meta.counters.workspaceFiles ?? 0)],
  ["Touched symbols", String(tsc.symbols.filter((s) => s.touched).length), String(tree.symbols.filter((s) => s.touched).length)],
  ["Symbols in graph", String(tsc.symbols.length), String(tree.symbols.length)],
  ["Files in graph", String(tsc.files.length), String(tree.files.length)],
  ["Edges", String(tsc.edges.length), String(tree.edges.length)],
  ["Of these, callee edges", String(sa.callee), String(sb.callee)],
  ["Of these, caller edges", String(sa.caller), String(sb.caller)],
  ["Edges the other side lacks", String(onlyA.length), String(onlyB.length)],
  ["Wall time", `${(tscRun.wallMs / 1000).toFixed(1)} s`, `${(tsRun.wallMs / 1000).toFixed(1)} s`],
  ["Peak RSS", `${tscRun.peakRssMb} MB`, `${tsRun.peakRssMb} MB`],
])}

Shared edges: **${shared}**. Tree-sitter found **${((shared / A.size) * 100).toFixed(0)}%** of the tsc edges and
invented **${onlyB.length}**.

Two runs of the tsc extractor produced byte-identical JSON: **${identical}**.
Every root file landed in the one program, so no program selection was ever
needed (\`rootFilesMissingFromProgram\` is
${tsc.meta.counters.rootFilesMissingFromProgram ?? "n/a"}).

## Symbols per file

The touched columns are the fairness check. Both extractors list symbols by the
same rules, and they agree on every touched file, so the edge comparison below
is about edges and not about disagreeing on what a symbol is.

The "in graph" columns count only the symbols that reached the graph, which
means the touched symbols plus the neighbors. A 0 against an untouched file
means that extractor never found an edge into that file, not that it cannot
list its symbols.

${table([
  ["File", "Status", "tsc in graph", "tree-sitter in graph", "tsc touched", "tree-sitter touched"],
  ...perFile,
])}

## Edges only tsc found (${onlyA.length})

${onlyA.length === 0 ? "None." : onlyA.map((k) => `- \`${k}\``).join("\n")}

Every one is the same failure: a barrel module. The import specifier resolves
to a real file on disk, but that file only re-exports the name. Lexical
resolution has nowhere to go.

## Edges only tree-sitter found (${onlyB.length})

${onlyB.length === 0 ? "None. Tree-sitter invented no edge on this pull request. Read the next section before trusting that." : onlyB.map((k) => `- \`${k}\``).join("\n")}

## Why zero false edges is not a clean bill of health

Tree-sitter scored well here for reasons that belong to this pull request and
not to the extractor:

1. **Every touched symbol is a free function with a distinctive name.** Not one
   is a method. The \`obj.foo()\` case, where only a receiver type can say which
   \`foo\` is meant, never fired: \`calleeEdgesFromMemberCallNameMatch\` is
   ${tree.meta.counters.calleeEdgesFromMemberCallNameMatch ?? 0}.
2. **${tree.meta.counters.calleeRoute_bareGlobal ?? 0} callee call sites and ${tree.meta.counters.callerRoute_bareGlobal ?? 0} caller call site were resolved by
   matching a name across the whole repository**, because the import came from a
   package specifier that no syntax-only tool can follow. Each one was correct
   only because the name happens to be unique. \`createError\` and
   \`createChatAgentWithMockModel\` are each declared exactly once.
3. **${tree.meta.counters.symbolNamesDeclaredInMoreThanOneFile ?? 0} of ${tree.meta.counters.distinctSymbolNames ?? 0} symbol names in lonir are declared in more than one
   file.** \`seedChat\` exists in 39 files. \`makeConvexTest\`, which this pull
   request touches, exists in 21. A pull request that touches one of those and
   imports it across a package boundary would get a fan of false edges.

So the measured wrongness on this pull request is zero, and the structural
wrongness is a coin flip that has not yet been called.

## Hand-verified sample, tsc side

Read from the checked out head, not from the tools.

${sampleTable(TSC_SAMPLE)}

Verdict count: ${["correct", "wrong", "missed"].map((v) => `${TSC_SAMPLE.filter((s) => s.verdict === v).length} ${v}`).join(", ")}.

## Hand-verified sample, tree-sitter side

${sampleTable(TREESITTER_SAMPLE)}

Verdict count: ${["correct", "wrong", "missed"].map((v) => `${TREESITTER_SAMPLE.filter((s) => s.verdict === v).length} ${v}`).join(", ")}.

## What both extractors miss

This is the finding that matters most for the analyzer, because it is not a
tsc against tree-sitter question at all.

A call inside \`it('...', () => { ... })\` has no enclosing symbol. The arrow is
an argument, not a named declaration, so neither extractor can name the caller.
The tsc extractor dropped ${tsc.meta.counters.callersAtModuleTopLevel ?? 0} incoming calls for this reason. One of them:
\`sendAction.truncation.test.ts:164\` calls \`turnProducedFinalText\`, which this
pull request touches, and no edge records it. For a pull request review diagram,
"which test covers this change" is exactly the edge a reviewer wants.

A second shared gap: \`apps/web/src/features/chat/hooks/resolveChatTurn.ts\` is a
touched file with zero touched symbols in both graphs. Its whole diff sits in a
doc comment and in the string body of \`TURN_ENDED_FALLBACK_TEXT\`, a plain data
const. Under the CONTEXT.md definition of Symbol that is correct, and it is
still a file the reviewer must see.

## Counters, tsc

${counterTable(tsc)}

## Counters, tree-sitter

${counterTable(tree)}

## Notes recorded by the extractors

**tsc**

${tsc.meta.notes.map((n) => `- ${n}`).join("\n")}

**tree-sitter**

${tree.meta.notes.map((n) => `- ${n}`).join("\n")}

## Deviations from the graph shape in the issue

- Added \`meta: { extractor, notes, counters }\` to \`Graph\`. The comparison needs
  the counters. A renderer can ignore the field.
- \`edges\` only ever holds \`kind: "call"\`. A \`new X()\` is recorded as a call to
  the class, which is what the research recommends, because a class is almost
  never called and would otherwise have no incoming edge at all.
- \`signatureTouched\` uses the range from the declaration keyword to the end of
  the parameter list, not the first line only. A multi-line parameter list is
  normal in this repository and the first line alone would miss it.
`;

  await Bun.write(join(OUT, "comparison.md"), md);
  console.log(`wrote ${join(OUT, "comparison.md")}`);
  console.log(
    `tsc ${tsc.edges.length} edges, tree-sitter ${tree.edges.length} edges, shared ${shared}, only tsc ${onlyA.length}, only tree-sitter ${onlyB.length}`,
  );
  console.log(
    `clean up with: git -C ${CLONE} worktree remove --force ${worktree} && git -C ${CLONE} update-ref -d ${ref}`,
  );
};

await main();
