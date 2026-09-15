# TypeScript call graph extraction options

## Summary

1. The TypeScript compiler API and ts-morph give the same call edges, because ts-morph calls the same language service; a measurement on `~/dev/lonir` found 286 calls to `cn` with both tools.
2. Neither tool marks a call in its reference results, so you must look at the parent node in the syntax tree to tell a call from a plain reference.
3. Do not give `projectReferences` to the program; a referenced project resolves to its `dist/*.d.ts` output, which has no function bodies, and this hides all callee edges in that package.
4. One program over all 3,321 workspace source files is enough for lonir; it needs 3.3 s and about 2.2 GB, and it contains every touched file, so you never select a program.
5. Reference order stayed the same across separate runs, but the compiler does not promise this, so sort every list yourself.

**Recommendation**: Use the raw TypeScript compiler API with one `ts.createLanguageService` over all workspace source files. Do not pass project references. Use `provideCallHierarchyIncomingCalls` for callers and a syntax tree walk for callees. Do not use ts-morph, because it gives the same results but costs about 2 times the time and about 1.4 times the memory, and it does not expose the call hierarchy API.

All measurements below come from `~/dev/lonir` at TypeScript 6.0.3.

### What lonir looks like

| Property | Value |
| --- | --- |
| Source files (`.ts`, `.tsx`) in `apps/`, `packages/`, `tools/` | 3,321 |
| Same, plus generated declarations in `packages/backend/convex/.dts` | 4,234 |
| Lines of source | 581,254 |
| `tsconfig*.json` files in the workspace tree | 30 |
| Workspace projects (`apps/*`, `packages/*`, `tools/*`) | 29 |
| Projects that the root `tsconfig.json` references | 16 |
| pnpm workspace globs | `apps/*`, `packages/*`, `tools/*` |
| TypeScript version | 6.0.3 |

The root `/Users/1k5/dev/lonir/tsconfig.json` holds `"files": []` and 16 `references` entries. It is a solution file. It has no source files of its own. Every package sets `composite: true`, `declaration: true` and `outDir: "./dist"`, and extends `/Users/1k5/dev/lonir/tsconfig.base.json`. Only `apps/web/tsconfig.json` sets `paths`, with 7 aliases below `@/*`.

---

## 1. How to find all call sites, and how to tell a call from a reference

### The two routes through the compiler API

The language service gives two entry points. Both are public in `/Users/1k5/dev/lonir/node_modules/typescript/lib/typescript.d.ts`:

```ts
getReferencesAtPosition(fileName: string, position: number): ReferenceEntry[] | undefined;   // :10235
findReferences(fileName: string, position: number): ReferencedSymbol[] | undefined;          // :10236
```

`findReferences` groups the results. `ReferencedSymbol` holds a `definition` and a `references` array (`typescript.d.ts:10750`). `getReferencesAtPosition` returns one flat list.

The search covers the program only. It does not read the disk. `src/services/services.ts:2471` passes `program.getSourceFiles()` into `FindAllReferences.findReferencedSymbols`. The global search then loops over exactly that array (`src/services/findAllReferences.ts:1335`). So a file that is not in the program can hold a call that you will never see.

`ts.FindAllReferences` is not public. A search for it in `typescript.d.ts` gives zero results.

The type checker gives the second route. You walk every node, you keep each `CallExpression`, and you resolve the callee:

```ts
getSymbolAtLocation(node: Node): Symbol | undefined;                       // typescript.d.ts:6234
getAliasedSymbol(symbol: Symbol): Symbol;                                  // typescript.d.ts:6279
getResolvedSignature(node: CallLikeExpression, ...): Signature | undefined; // typescript.d.ts:6269
```

The walk route costs one pass for the whole program. The `findReferences` route costs one query for each target symbol. `findReferences` is keyed on the name text: `getPossibleSymbolReferencePositions` runs `text.indexOf(symbolName, container.pos)` over the file text and then resolves each hit (`src/services/findAllReferences.ts:1782`). For a small set of touched symbols, `findReferences` is cheaper. For a full graph, the walk is cheaper.

### Nothing in the results marks a call

This is the important limit. `ReferenceEntry` extends `DocumentSpan` and adds two fields only:

```ts
interface ReferenceEntry extends DocumentSpan {   // typescript.d.ts:10635
    isWriteAccess: boolean;
    isInString?: true;
}
```

`DocumentSpan` holds `textSpan`, `fileName` and four optional remap fields (`typescript.d.ts:10615`). `ReferencedSymbolEntry` adds `isDefinition?: boolean` (`typescript.d.ts:10754`). A measurement confirms this: the observed keys of a live entry were `["textSpan","fileName","contextSpan","isWriteAccess","isInString","isDefinition"]`. So `foo()`, `arr.map(foo)` and `const x = foo` look the same in the results. You must go back to the syntax tree at `textSpan.start`.

### How to tell them apart

Take the identifier at the position. Climb up while the node is the `name` of a `PropertyAccessExpression`, because `a.b()` puts the `CallExpression` two levels above `b`. Then test the parent:

| Test | Meaning |
| --- | --- |
| `ts.isCallExpression(p) && p.expression === node` | a call |
| `ts.isNewExpression(p) && p.expression === node` | a construction |
| `ts.isTaggedTemplateExpression(p) && p.tag === node` | a tagged template call |
| `ts.isDecorator(p) && p.expression === node` | a decorator call |
| `ts.isJsxOpeningElement(p) && p.tagName === node` | a component call |
| anything else | a plain reference |

The identity test `p.expression === node` is necessary. For `arr.map(foo)` the parent of `foo` is also a `CallExpression`, but `foo` sits in `p.arguments`, not in `p.expression`. A test on the parent kind alone reports a false call.

TypeScript does the same thing inside itself. `isCalleeWorker` in `src/services/utilities.ts:636` climbs past property access, skips outer expressions such as `(foo as any)()`, and then compares the selected callee against the node.

All the type guards above are public: `isCallExpression` (`typescript.d.ts:9033`), `isNewExpression` (`:9034`), `isTaggedTemplateExpression` (`:9035`), `isDecorator` (`:8990`), `isPropertyAccessExpression` (`:9031`).

### The call hierarchy API does most of this for you

The language service exposes a public call hierarchy:

```ts
prepareCallHierarchy(fileName: string, position: number): CallHierarchyItem | CallHierarchyItem[] | undefined;  // :10242
provideCallHierarchyIncomingCalls(fileName: string, position: number): CallHierarchyIncomingCall[];             // :10243
provideCallHierarchyOutgoingCalls(fileName: string, position: number): CallHierarchyOutgoingCall[];             // :10244

interface CallHierarchyItem {          // :10450
    name: string; kind: ScriptElementKind; kindModifiers?: string;
    file: string; span: TextSpan; selectionSpan: TextSpan; containerName?: string;
}
interface CallHierarchyIncomingCall { from: CallHierarchyItem; fromSpans: TextSpan[]; }  // :10459
interface CallHierarchyOutgoingCall  { to: CallHierarchyItem; fromSpans: TextSpan[]; }   // :10463
```

`getIncomingCalls` runs `findReferences` and then applies the call filter (`src/services/callHierarchy.ts:476`). It searches the whole program, because it passes `program.getSourceFiles()` (`src/services/callHierarchy.ts:482`). It groups the results by the containing declaration. This is exactly the caller shape that this tool needs.

A measurement on `cn` in `/Users/1k5/dev/lonir/packages/ui/src/cn.ts` shows the agreement:

| Method | Result |
| --- | --- |
| `findReferences` | 149 `ReferencedSymbol`, 435 entries |
| Manual syntax tree filter of those entries | 286 calls, 148 imports or exports, 1 declaration |
| `provideCallHierarchyIncomingCalls` | 189 caller items, 286 spans in total |

The 286 spans match the 286 calls. The 189 items are the functions that hold those calls. `containerName` gives the owning class at no extra cost: for the method `getRelationships` it returned `RelationshipCollector`.

Three limits apply, and all three change the design:

1. **Incoming calls over-report for methods.** `convertEntryToCallSite` accepts `isRightSideOfPropertyAccess(node)` and `isArgumentExpressionOfElementAccess(node)` as top level alternatives (`src/services/callHierarchy.ts:449`). So `const f = obj.method;` counts as an incoming call even though nobody calls it. For a free function such as `cn` there is no property access, and this is why the measured counts matched. For methods you must filter the spans again yourself.
2. **Outgoing calls are incomplete.** For `cn`, whose body is `twMerge(clsx(inputs))`, `provideCallHierarchyOutgoingCalls` returned 1 target (`clsx`) and missed `twMerge`. Use a syntax tree walk of the body for callees.
3. **Declaration files give no outgoing calls.** `getOutgoingCalls` returns an empty array for ambient declarations (`src/services/callHierarchy.ts:688`). This is the reason that question 2 matters so much.

### ts-morph

ts-morph 28.0.0 depends on `@ts-morph/common` 0.29.0, which bundles its own TypeScript 6.0.2. It does not use the TypeScript in your repository. Its reference API is thin:

| Member | Owner | Exists |
| --- | --- | --- |
| `findReferences(): ReferencedSymbol[]` | `ReferenceFindableNode` | yes |
| `findReferencesAsNodes(): Node[]` | `ReferenceFindableNode` | yes |
| `getReferencingNodesInOtherSourceFiles()` | `SourceFile` | yes |
| `getReferencingSourceFiles()` | `SourceFile` | yes |
| `getReferencingNodes()` | any node | **no** |
| any call hierarchy method | `LanguageService` | **no** |

The ticket asks about `getReferencingNodes`. That exact name does not exist. A run over the live object found only `findReferences` and `findReferencesAsNodes` on `VariableDeclaration`. The ts-morph `LanguageService` exposes `findReferences`, `findReferencesAsNodes`, `findReferencesAtPosition`, `getDefinitions`, `getDefinitionsAtPosition`, `getImplementations` and `getImplementationsAtPosition`. It exposes no call hierarchy method. A search for `CallHierarchy` in `ts-morph.d.ts` gives zero results. To reach the call hierarchy you must drop to `project.getLanguageService().compilerObject`.

Only some nodes can answer `findReferences`. `Node.isReferenceFindable` accepts 30 kinds. `ArrowFunction` is **not** one of them, so you always ask the `VariableDeclaration` instead. `ImportSpecifier` and `ExportSpecifier` are not in the list either; use their name identifier.

ts-morph gives the same answer as the compiler API, because it wraps the same language service. On the same `cn` symbol, `findReferencesAsNodes()` returned 434 nodes, and the same syntax tree filter found 286 calls and 148 other references. `findReferences()` returned 149 `ReferencedSymbol` and 435 entries. These numbers match the raw compiler API.

Two ts-morph behaviours explain the small differences and will bite you:

1. **`findReferencesAsNodes()` drops the declaration.** For a symbol that is not an alias it skips the first entry when `isDefinition()` is true. That is why it returned 434 nodes where `findReferences()` returned 435 entries.
2. **Each importing file adds a second `ReferencedSymbol` group** with the definition kind `alias`. So the same position can appear in two groups. This is why 147 files produced 149 groups. Deduplicate by `(filePath, textSpan.start)`.

ts-morph is more pleasant to read. `node.getParentIfKind(SyntaxKind.CallExpression)` and `Node.isCallExpression(n)` replace the raw guards. But `getParentIfKind` only proves that the node is a child of a call, not that it is the callee, so you still compare `call.getExpression() === node` and still climb the property access yourself. ts-morph removes no real work here.

---

## 2. How to build the program for a monorepo like lonir

### A program per tsconfig does not work

The root `tsconfig.json` is a solution file. `ts.getParsedCommandLineOfConfigFile` on it returns **0** file names and 16 project references. A ts-morph `Project` built with `tsConfigFilePath` pointed at it holds **0** source files. So the obvious starting point gives you nothing.

The per package configs are also narrower than the folders suggest. `packages/backend/tsconfig.json` includes `src/**/*` and `scripts/**/*` only, so it parses to **43** root files, although `packages/backend` holds 1,841 files. Most of them belong to `packages/backend/convex`, which is a separate referenced project. `packages/data/tsconfig.json` parses to 11 root files. `apps/web/tsconfig.json` parses to 1,415.

The root solution is also not complete. It references 16 of the 29 workspace projects. `packages/evals`, `packages/sourcebook-import`, `apps/mobile`, `apps/release-notes` and the three `tools/*` projects are absent. So even `tsc -b` at the root would not cover the repository.

### Project references hide the function bodies

This is the single most important result. The handbook states the behaviour: "Importing modules from a referenced project will instead load its output declaration file (`.d.ts`)".

A measurement on `apps/web` confirms it and gives the size of the loss:

| Program build | Source files | From `dist/*.d.ts` | `packages/ui` source | `packages/ui` declarations |
| --- | --- | --- | --- | --- |
| `projectReferences` passed | 4,984 | 188 | 0 | 143 |
| `projectReferences` omitted | 5,756 | 0 | 178 | 0 |

With project references, `packages/ui`, `packages/editor`, `packages/data`, `packages/property-types` and `packages/telemetry` arrive as declaration files only. `packages/compliance`, `packages/errors` and `packages/import` do not arrive at all. A declaration file has no function bodies. So every callee edge inside those packages disappears, and `getOutgoingCalls` returns nothing for them (`src/services/callHierarchy.ts:688`).

`disableSourceOfProjectReferenceRedirect: true` changed nothing in the measurement. Both runs gave 4,984 files. The reason is that the redirect back to source needs a host hook that the public API does not offer. The program reads `host.useSourceOfProjectReferenceRedirect?.()` (`src/compiler/program.ts:1723`), but the public `CompilerHost` (`typescript.d.ts:7359`) does not declare that member, and `ts.createCompilerHost` does not implement it. A run confirmed this: `typeof host.getParsedCommandLine` and the redirect hook are both `undefined` on a host from `ts.createCompilerHost`. Only `WatchCompilerHost` declares the hook in public (`typescript.d.ts:9876`).

So the fix is simple. Do not pass `projectReferences`. Plain module resolution then follows the `exports` field of each package. Every lonir package points its `exports` at source, for example `packages/ui` maps `"."` to `"./src/index.ts"` and `packages/telemetry` maps `"./client"` to `"./src/client.ts"`. This condition is what makes the fix work. A package that pointed `exports` at `dist` would still give declaration files.

### The solution builder gives one program per project

`ts.createSolutionBuilder` (`typescript.d.ts:9934`) does not give a single program over the whole solution. `SolutionBuilder` exposes no `getProgram`. The only route to a program is `getNextInvalidatedProject()` and then `BuildInvalidedProject.getProgram()` (`typescript.d.ts:10005`), which is one program for one project. `src/compiler/tsbuildPublic.ts:1022` builds that program from a single project's config. So the solution builder does not solve the cross package caller problem.

### Use one program over the whole workspace

Collect every `.ts` and `.tsx` file under `apps/`, `packages/` and `tools/`, drop `node_modules`, `dist` and dot folders, sort the list, and hand it to one program with widened options from `tsconfig.base.json`. The measured result:

| Property | Value |
| --- | --- |
| Root file names | 3,321 |
| Source files in the program | 7,415 |
| Of these: workspace source | 3,322 |
| Of these: `node_modules` | 4,032 |
| Of these: `lib.*.d.ts` | 61 |
| Of these: `dist/*.d.ts` | **0** |
| `ts.createProgram` | 3,347 ms |
| `getTypeChecker` | 631 ms |
| Root names missing from the program | **0** |

Zero declaration files from `dist`. Every function body is present. And because no root file is missing, **the question "which program holds this touched file" disappears**. Every touched workspace file is in the one program. This removes a whole class of bugs.

The program is always a superset of its roots. The JSDoc on `createProgram` states it: "Creating a program proceeds from a set of root files, expanding the set of inputs by following imports and triple-slash-reference-path directives transitively." The `exclude` documentation says the same from the other side: a file that `exclude` drops "can still become part of your codebase due to an `import` statement in your code".

To test membership, call `program.getSourceFile(fileName)` (`typescript.d.ts:5982`). It canonicalises the path for you (`src/compiler/program.ts:2775`). Pass absolute paths with forward slashes that match the root names you supplied. `ts.toPath` and `ts.createGetCanonicalFileName` are not public, so do not try to build a `Path` yourself.

### ts-morph for the same job

ts-morph reaches the same place with more code and more cost:

```ts
const project = new Project({ compilerOptions, skipAddingFilesFromTsConfig: true });
project.addSourceFilesAtPaths([...globs]);
project.resolveSourceFileDependencies();
```

Measured on lonir: `addSourceFilesAtPaths` took 4,285 ms for 3,321 files, and `resolveSourceFileDependencies()` took a further 2,202 ms and added 1 file. That is 6,487 ms in total against 3,347 ms for `ts.createProgram`.

ts-morph counts differently from the compiler. For `apps/web/tsconfig.json`, `project.getSourceFiles()` returned 2,331 files, while `project.getProgram().compilerObject.getSourceFiles()` returned 5,756. ts-morph shows you the files it wrapped, not the whole program. Use `project.getProgram().compilerObject` when you need the real program.

Do not test membership with `project.getSourceFile(absolutePath) != null`. That lookup deliberately returns files that are not in the project, including library files. Build a `Set` from `project.getSourceFiles().map(f => f.getFilePath())` instead. Also note that a relative path that holds a `/` is resolved against the current working directory, not matched as a suffix, although the documentation suggests otherwise.

ts-morph has no support for project references or the solution builder. Its single `ts.createProgram` call passes five arguments, and the sixth parameter, `projectReferences`, is never supplied. A search for `projectReferences` in its shipped code gives zero results.

---

## 3. Determinism

**Reference order was stable in every measurement, but no primary source promises it.**

The measurements. `findReferences` on `cn` was run twice in one process and then again in a second process. The hash of the `fileName:textSpan.start` sequence was `744d2cd4e332` every time. The same test on `prewarmEntityTimeline` gave `20d73b49f222` every time. The hash of `program.getSourceFiles()` for `apps/web` was `508e2736766c9cf8` in two separate processes. ts-morph gave a stable hash across passes too.

The reason the order holds. `program.getSourceFiles()` is a post-order walk from the root names in root order: `processImportedModules(file)` runs before the file is pushed (`src/compiler/program.ts:3696`), and default library files come first through a fixed comparator (`src/compiler/program.ts:1826`). A global reference search then loops over that array (`src/services/findAllReferences.ts:1335`), and within one file the candidate positions rise, because `getPossibleSymbolReferencePositions` uses an ascending `indexOf` loop (`src/services/findAllReferences.ts:1782`).

**What you must sort yourself.**

1. **The root file names.** If you build them from a directory glob, the order comes from the file system. Sort them before you create the program. This is the one input that decides everything downstream.
2. **Reference results.** `typescript.d.ts:10235` and `:10236` carry no documentation about order. The only explicit sort inside `findAllReferences` is `mergeReferences` (`src/services/findAllReferences.ts:1117`), and it runs only when the target symbol is a module. Cross file import chasing appends entries as it walks the import graph, so the sequence is not plain program order. Sort by `(fileName, textSpan.start, textSpan.length)`.
3. **Call hierarchy results.** The order follows the grouping of the underlying reference entries. It is not documented. Sort it.

ts-morph behaves the same way and adds one risk. Its `findReferences` applies no sort at all; it passes the language service result straight through. Its `getSourceFiles()` **is** sorted, by directory depth and then by base name, but the comparator is locale sensitive. So the order can change between machines with different locale settings. Sort by `getFilePath()` yourself if you use ts-morph.

**Diagnostics are already sorted.** `program.getSemanticDiagnostics()` passes through `getDiagnosticsHelper`, which calls `sortAndDeduplicateDiagnostics` (`src/compiler/program.ts:2778`). `ts.sortAndDeduplicateDiagnostics` is public (`typescript.d.ts:8574`). The comparator sorts by file path, then start, then length, then code, then message. `ts.compareDiagnostics` is internal and not public.

One more trap. An incrementally reused program keeps the old program's file order (`src/compiler/program.ts:2557`). Build a fresh program for each run if you want a reproducible artifact.

---

## 4. Memory and time on a repo the size of lonir

All numbers are measured with Bun on macOS against lonir at TypeScript 6.0.3.

| Task | Time | Peak RSS |
| --- | --- | --- |
| Parse one tsconfig | 210 ms to 296 ms | small |
| `ts.createProgram`, `apps/web` only (5,756 files) | 2,202 ms to 2,418 ms | 1,235 MB |
| `ts.createProgram`, whole workspace (7,415 files) | 3,347 ms | 1,780 MB |
| `getTypeChecker` after that | 631 ms | 2,165 MB |
| `ts.createLanguageService` over the workspace | 3,349 ms | 2,285 MB |
| Peak after many reference queries | n/a | 2,654 MB |
| ts-morph, whole workspace, add plus resolve | 6,487 ms | 2,687 MB |
| ts-morph peak after reference queries | n/a | 3,724 MB |

Reference query cost, measured on `cn` with 435 entries across 147 files:

| Query | First call | Second call |
| --- | --- | --- |
| `findReferences` (compiler API) | 337 ms | 130 ms |
| `provideCallHierarchyIncomingCalls` | 59 ms | n/a |
| `findReferencesAsNodes` (ts-morph) | 794 ms | 115 ms |

A small symbol is much cheaper. `prewarmEntityTimeline`, with 2 entries, took 82 ms and then 66 ms.

Read this as follows. The one time cost of about 3.3 s and about 2.2 GB dominates. Each symbol after that costs between 60 ms and 340 ms. A pull request that touches 20 symbols therefore costs about 3.3 s plus about 4 s. That is acceptable for a local tool. But 2.2 GB is close to the default heap limit of Node.js, so run the tool on Bun or raise `--max-old-space-size`.

ts-morph costs about 1.9 times the time and about 1.4 times the peak memory for the same answer.

The documented guidance agrees with the shape of these numbers, although TypeScript publishes no absolute figures:

- The performance wiki names the failure this avoids: "The editor's language service runs out of memory when trying to process the code as a single project." Its remedy is to split into projects, and it says "5-20 projects is an appropriate range". lonir has 29 workspace projects. This tool goes the other way on purpose, because one program is what makes cross package callers visible.
- `skipLibCheck` "can save time during compilation at the expense of type safety". lonir already sets it in `tsconfig.base.json`. Keep it.
- On file discovery: "`include`/`exclude` help avoid needing to specify these files, but at a cost: files must be discovered by walking through included directories." An explicit sorted root list is both faster and deterministic, which is what section 3 needs.
- `--extendedDiagnostics` prints where the compiler spends time, and `--generateTrace` gives a trace. Use them if the numbers above get worse.

The ts-morph documentation gives no guidance here. It has no FAQ page, and its only performance page covers manipulation, not analysis. It documents `skipAddingFilesFromTsConfig` and `skipFileDependencyResolution` as behaviour switches and never as performance switches. Its `forget()`, `forgetDescendants()` and `forgetNodesCreatedInBlock()` methods exist because ts-morph keeps every wrapped node alive across edits. This tool never edits code, so those methods do not help it. That wrapper cache is the reason for the extra memory in the table above.

---

## 5. Mapping a symbol to a stable id and a line range

### The line range

```ts
getStart(sourceFile?: SourceFile, includeJsDocComment?: boolean): number;  // typescript.d.ts:4312
getEnd(): number;                                                         // typescript.d.ts:4314
getLineAndCharacterOfPosition(pos: number): LineAndCharacter;             // typescript.d.ts:5955
```

`node.pos` is not `node.getStart()`. `pos` includes the leading trivia. `getLeadingTriviaWidth` is defined as `getStart() - pos` (`src/services/services.ts:438`). The measurement shows how large the gap gets: the function `cn` has `pos = 85` and `getStart() = 87`, but the class `RelationshipCollector` has `pos = 1487` and `getStart() = 1940`. That is 453 characters of doc comment. Always use `getStart()` for a range, and pass `includeJsDocComment = true` only if the doc comment belongs in the range.

`getStart()` calls `assertHasRealPosition()` (`src/services/services.ts:412`), so it throws on a synthesized node.

`line` and `character` are both 0-based. The declaration says so: "0-based." on `LineAndCharacter.line` and "0-based. This value denotes the character position in line and is different from the 'column' because of tab characters." on `character` (`typescript.d.ts:7192`). Add 1 for anything a person reads. The measurement agrees: `cn` sits on line 4 of its file and the API reported line 3.

ts-morph is 1-based instead. `getStartLineNumber()` returned 4 for the same `cn` declaration, and returned 1 for a declaration on the first line of a file. `SourceFile.getLineAndColumnAtPos` documents itself as "1-indexed", and the helper behind it ends with `return count + 1`. If you mix the two APIs you will produce an off-by-one error.

One useful detail for this tool: `getStartLineNumber(true)` moves the start back to the first line of the doc comment. A pull request that changes only a doc comment then still overlaps the symbol range. Prefer `getStartLineNumber(true)` to `getEndLineNumber()` when you match touched lines against symbols. The compiler API gives the same effect with `getStart(sourceFile, true)`.

### The stable id

**Do not use `checker.getFullyQualifiedName`.** It is public (`typescript.d.ts:6259`), but it embeds an absolute path. The measured output for `cn` was:

```
"/Users/1k5/dev/lonir/packages/ui/src/cn".cn
```

The binder builds that name as `` `"${removeFileExtension(file.fileName)}"` `` (`src/compiler/binder.ts:3122`), and `getFullyQualifiedName` joins the parent chain with `"."` (`src/compiler/checker.ts:4502`). The result moves with the checkout directory, so it is not stable. It is also empty of structure for a symbol that is not exported. Use it for display only.

Build the id yourself from three parts: the repository relative posix path, the declaration kind, and the qualified name built from the chain of named ancestors. The measured ids:

| Symbol | Id |
| --- | --- |
| `cn` | `packages/ui/src/cn.ts#FunctionDeclaration:cn` |
| `prewarmEntityTimeline` | `apps/web/src/features/events/prewarm.ts#VariableDeclaration:prewarmEntityTimeline` |
| `RelationshipCollector` | `packages/import/src/.../relationshipCollector.ts#ClassDeclaration:RelationshipCollector` |
| `getRelationships` | `packages/import/src/.../relationshipCollector.ts#MethodDeclaration:RelationshipCollector.getRelationships` |

The class name arrives free in the method id, because the ancestor walk collects it. `CallHierarchyItem.containerName` gives the same answer if you use the call hierarchy.

### Class members

`node.parent` of a `MethodDeclaration` is the class. But `ClassDeclaration.name` is optional, and the declaration says why: "May be undefined in `export default class { ... }`" (`typescript.d.ts:5425`). Handle that case. Use the name `default`, which matches how the binder names it.

### Arrow functions assigned to consts

This case needs care, and a naive filter drops it.

The declaration node is a `VariableDeclaration` whose `initializer` is an `ArrowFunction` or a `FunctionExpression`. The symbol lives on the `VariableDeclaration` name, not on the arrow. Detect it with `ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))`. Guard `d.name` with `ts.isIdentifier`, because `name` is a `BindingName` and can be a destructuring pattern.

**The symbol flags are not `Function`.** The measurement on `prewarmEntityTimeline` reported `BlockScopedVariable`. `SymbolFlags.Function` is 16, `BlockScopedVariable` is 2, and `Variable` is 3 (`typescript.d.ts:6470`). So a filter written as `symbol.flags & ts.SymbolFlags.Function` silently drops every arrow function const. In a modern codebase that is most of the functions.

TypeScript itself solves this by structure and not by flags. `isValidCallHierarchyDeclaration` accepts a named expression or an assigned expression (`src/services/callHierarchy.ts:191`), and its comment states the rule: function expressions count "with a name or assigned to a const variable", and arrow functions count when "assigned to a const variable".

The measurement also shows why call classification matters for these. `prewarmEntityTimeline` had 2 reference entries and **0** of them were calls. It is passed as a value, not invoked. The call hierarchy agreed: 0 incoming calls, 2 outgoing calls.

### Classes and constructions

A class reference is usually a `new`, not a call. `RelationshipCollector` had 8 entries: 1 `new`, 0 calls and 7 other. `StructuredError` had 16 entries: 1 `new` and 15 other. Count `NewExpression` as an edge to the constructor, or the graph will show no edges into classes at all.

In ts-morph the same job uses `VariableDeclaration.getInitializerIfKind(SyntaxKind.ArrowFunction)`, which a run confirmed returns the `ArrowFunction`. `VariableDeclaration` is reference findable, and `findReferencesAsNodes()` on one returned nodes as expected.

---

## 6. What tree-sitter cannot do here

Tree-sitter states four goals for itself: "General enough to parse any programming language", "Fast enough to parse on every keystroke in a text editor", "Robust enough to provide useful results even in the presence of syntax errors", and "Dependency-free so that the runtime library (which is written in pure C11) can be embedded in any application". Every one of those goals is about syntax. Its documentation says nothing about semantic analysis, name resolution, type checking, or reading a second file. That is the whole problem for this tool. Tree-sitter can see the text `foo()` in one file, but it cannot say which `foo` that is. It cannot follow `import { foo } from '@lonir/ui'` to `packages/ui/src/index.ts`, and then through the re-export to `packages/ui/src/cn.ts`, because module resolution needs the `exports` field of a `package.json`, the `paths` aliases in a tsconfig, and the pnpm link layout. It cannot tell a method call `a.b()` from any other `b` in the repository, because that needs the type of `a`. It cannot see that `const f = cn` and a later `f(x)` are a call to `cn`. For a repository where 148 of 435 references to one function are import statements, and where the true caller set spans three packages, a syntax-only parser would produce a graph built on name collisions. Tree-sitter is the right tool to list the declarations inside one file quickly, and it is the wrong tool to draw an edge between two files. Use it only as a fast fallback for a file that the program does not contain.

---

## References

### Primary: TypeScript documentation

- Project references handbook: https://www.typescriptlang.org/docs/handbook/project-references.html
- `exclude`: https://www.typescriptlang.org/tsconfig/#exclude
- `include`: https://www.typescriptlang.org/tsconfig/#include
- `files`: https://www.typescriptlang.org/tsconfig/#files
- `skipLibCheck`: https://www.typescriptlang.org/tsconfig/#skipLibCheck
- `incremental`: https://www.typescriptlang.org/tsconfig/#incremental
- `disableSourceOfProjectReferenceRedirect`: https://www.typescriptlang.org/tsconfig/disableSourceOfProjectReferenceRedirect.html
- `disableReferencedProjectLoad`: https://www.typescriptlang.org/tsconfig/#disableReferencedProjectLoad
- TypeScript 3.7 release notes, "Build-free Editing with Project References": https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html
- Performance wiki: https://github.com/microsoft/TypeScript/wiki/Performance

### Primary: TypeScript source

Shipped declarations, read at `/Users/1k5/dev/lonir/node_modules/typescript/lib/typescript.d.ts`, version 6.0.3. Cited by line number throughout. Compiler and services source cross-checked against `microsoft/TypeScript` branch `release-6.0`:

- `src/services/services.ts`: `findReferences` passes `program.getSourceFiles()` (:2471)
- `src/services/findAllReferences.ts`: global search loop (:1335), ascending `indexOf` scan (:1782), `mergeReferences` sort (:1117)
- `src/services/callHierarchy.ts`: `getIncomingCalls` (:476), call site filter (:441 to :457), valid declarations (:181 to :193), ambient bail out (:688)
- `src/services/utilities.ts`: `isCalleeWorker` and `climbPastPropertyAccess` (:636 to :651)
- `src/compiler/program.ts`: redirect hook read (:1723), file order (:1826, :3696), `getSourceFile` lookup (:2775), sorted diagnostics (:2778), incremental reuse (:2557)
- `src/compiler/tsbuildPublic.ts`: one program per project (:1022)
- `src/compiler/checker.ts`: `getFullyQualifiedName` (:4502)
- `src/compiler/binder.ts`: module symbol name (:3122)
- `src/compiler/types.ts`: `LineAndCharacter` is 0-based (:7643)
- Current `main` is the Go port; the reference and call hierarchy code lives at `tsc/internal/ls/findallreferences.go` and `tsc/internal/ls/callhierarchy.go`

### Primary: ts-morph

- Documentation: https://ts-morph.com
- Setup and instantiation options: https://ts-morph.com/setup/
- Adding source files, and dependency resolution: https://ts-morph.com/setup/adding-source-files
- Getting source files: https://ts-morph.com/navigation/getting-source-files
- Language service: https://ts-morph.com/navigation/language-service
- Performance and the forget API: https://ts-morph.com/manipulation/performance
- Source: https://github.com/dsherret/ts-morph
- Version inspected: ts-morph 28.0.0, which depends on `@ts-morph/common` 0.29.0 and bundles TypeScript 6.0.2. API surface read from the live objects and from `node_modules/ts-morph/lib/ts-morph.d.ts`.
- `packages/ts-morph/src/compiler/ast/base/name/ReferenceFindableNode.ts`: the reference mixin
- `packages/ts-morph/src/compiler/tools/LanguageService.ts`: `findReferencesAsNodes` drops the definition entry, and applies no sort
- `packages/ts-morph/src/factories/DirectoryCache.ts`: source files held in a locale sorted array
- `packages/ts-morph/src/Project.ts`: `getSourceFile` path handling and the in-project filter

### Primary: tree-sitter

- Documentation and stated goals: https://tree-sitter.github.io/tree-sitter/

### Primary: the lonir repository

Read only, at `/Users/1k5/dev/lonir`, TypeScript 6.0.3.

- `tsconfig.json`: solution file, `"files": []`, 16 references
- `tsconfig.base.json`: shared compiler options
- `apps/web/tsconfig.json`: `composite`, 7 `paths` aliases, 7 references
- `packages/backend/tsconfig.json`: `include` of `src/**/*` and `scripts/**/*` only
- `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `tools/*`
- `packages/*/package.json`: `exports` point at `./src/*.ts`
- `packages/ui/src/cn.ts`, `apps/web/src/features/events/prewarm.ts`, `packages/import/src/sources/archivist/transform/relationshipCollector.ts`, `packages/errors/src/index.ts`: the measured symbols

All timings and counts in this document were produced by throwaway scripts run against this repository. They are not committed.
