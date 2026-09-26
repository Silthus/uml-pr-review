## Resolution (wf-17-repo-index, Opus)

**Verdict: yes.** A whole-repository index of PostHog is interactive-fast and reproduces the architecture PostHog enforces on itself.

Branch: [`prototype/repository-index`](https://github.com/Silthus/uml-pr-review/tree/prototype/repository-index) (commit a3da428). Code is in [`prototype/repository-index/`](https://github.com/Silthus/uml-pr-review/tree/prototype/repository-index/prototype/repository-index). Data is in [`out/posthog-architecture.json`](https://github.com/Silthus/uml-pr-review/blob/prototype/repository-index/prototype/repository-index/out/posthog-architecture.json) (6.7 MB) and [`out/runs/*.json`](https://github.com/Silthus/uml-pr-review/tree/prototype/repository-index/prototype/repository-index/out/runs) (raw per-run reports). `out/findings.md` was not committed: the subagent harness refuses report `.md` files. This comment is the findings document. The conductor can commit it verbatim.

Target: `~/dev/posthog` at `f637db96`. Machine: 18-core Apple Silicon, Bun 1.4.2.

### 1. Index time and memory

Input: every py/ts/js blob at HEAD. That is 40,210 paths, 39,194 unique blobs, 375 MB, read through `git cat-file --batch`. Each worker holds one tree-sitter WASM instance and reads its own 100-blob chunk.

| Run | Wall | Max RSS | Phys. footprint |
|---|---|---|---|
| Cold, import-only extractor, 18 workers | 5.38 s | 1,865 MB | 825 MB |
| Cold, import-only, 8 workers | 5.95 s | 1,181 MB | 558 MB |
| Cold, import-only, 4 workers | 9.43 s | 1,043 MB | 439 MB |
| Cold, import-only, 1 worker | 33.75 s | 530 MB | 200 MB |
| Cold, v1 `extractSourceFile` (symbols + calls + imports), 18 workers | 6.49 s | 2,261 MB | 896 MB |
| Cold, v1 extractor, 1 worker | 38.40 s | 609 MB | 198 MB |
| Cold + write `bun:sqlite` cache | 6.02 s | 2,105 MB | 773 MB |
| **Warm** (39,194/39,194 cache hits) | **0.36 s** | 173 MB | 135 MB |
| Warm + resolve + tree + aggregation + JSON | 1.39 s | 1,032 MB | 953 MB |

- Parsing dominates. The full v1 extractor (371k symbols) costs only 14 % more than import-only.
- Scaling flattens at about 8 workers, where the main thread and `cat-file` become the limit. **Use `min(cores, 8)` workers.** Each worker costs about 80–100 MB RSS.
- The cache is 51 MB for 39k blobs, keyed by `(blob sha, extractor version)` (`WITHOUT ROWID`, WAL). Looking up all SHAs takes 270–300 ms. A long-lived server should hold the results in memory.

### 2. Working-tree snapshot

The experiment ran `worktree add --detach /tmp/ph-snapshot-wt` and made three edits: M a facade file with a new cross-product import, A a new Python file, D a `.tsx`. It then snapshotted the worktree with a temporary `GIT_INDEX_FILE`.

| Step | Time |
|---|---|
| Copy the real index to a temp file, then `add -A` | **220 ms** |
| `write-tree` | **31 ms** |
| `add -A` into an **empty** temp index | 2,576 ms |
| Re-index the snapshot with the warm cache | 299 ms extract (**2 blobs parsed**, 39,192 hits) + 552 ms resolve |

- `diff-tree HEAD^{tree} <snapshot>` shows exactly the three edits.
- The worktree's own index and PostHog's main `.git/index` have identical SHA-256 before and after, and `git --no-optional-locks status` is identical too.
- The re-index finds both new edges.
- The worktree was removed and pruned.
- **Correctness finding:** the empty-index variant produced a *different* tree. It lost **161 tracked-but-ignored files** (`.envrc`, `.idea/*`, `frontend/__snapshots__/*.png`), because `add -A` never re-adds ignored paths. **Always seed the temp index from a copy of the real index.**
- Side effect: loose, unreachable blobs and trees were written into PostHog's object store. `gc` cleans them. Nothing else changed.

### 3. Import resolution

Of 265,911 import references, 91,542 are external (stdlib, PyPI, npm). **In-repository: 174,312 resolved, 57 unresolved, a 99.97 % resolution rate.**

| Family | Resolved | Unresolved | v1 `ModuleResolver` hits |
|---|---|---|---|
| py `posthog.*` | 30,700 | 1 | 29,961 |
| py `products.*` | 45,660 | 0 | 45,291 |
| py `ee.*` / `common.*` / relative | 1,993 / 94 / 3,842 | 0 | about the same |
| py other first-party (`llm_gateway`, `hogli`, `posthog_owners`) | 630 | 0 | **5** |
| ts relative | 32,616 | 9 | 32,596 |
| ts `scenes/*` / `lib/*` / `products/*` | 7,421 / 15,934 / 3,028 | 0 | about the same |
| ts `~/*` | 16,091 | 0 | **11,711** |
| ts `@posthog/*` | 14,141 | 24 | **0** |
| ts `storybook/*` | 0 | 17 | 0 |

**Resolution fixes to adopt:**

1. **Workspace packages by `package.json` name.** Try `exports` (conditions `source` > `development` > `import` > `default`), then `module`, `main`, `src/index`. Retry `dist|lib|build/` entries as `src/`. v1 resolved 0 of 14k `@posthog/*` imports.
2. **Real tsconfig `paths`.** Use the nearest `tsconfig.json` that has `paths`, following its relative `extends` chain. Longest pattern wins. Parse with `Bun.JSONC`. v1's suffix heuristic missed 4.4k `~/*` imports and **picked the wrong file 39 times**. Example: `nodejs` `~/common/metrics` became `nodejs/src/ingestion/common/metrics.ts`.
3. **Alias targets inside `node_modules` are external.** Examples: `@posthog/icons`, `@storybook/react`, `@tiptap/*`. This removed about 2,800 false "unresolved".
4. **Python source roots.** Take them from every `pyproject.toml`/`setup.py`, including `src/` layouts. Search owning roots first, then `.`, then the others. This handles uv-workspace imports across projects.
5. **Python submodules first.** `from a.b import c` tries `a/b/c.py` first, then `a/b/__init__.py` for the remaining names. Namespace directories resolve to the module.
6. **Extract the import forms v1 never sees.**
   - side-effect imports
   - `export … from` (1,204 edges)
   - `import()` (762)
   - `require()` (36)
   - function-local Python imports (3,615 `lazy` edges)
   - `TYPE_CHECKING` imports (kind `type`)

   Each edge keeps its kind.
7. **Drop v1's suffix/stem fallback** from the index.

**The 57 unresolved are genuine defects:**

| Count | Cause |
|---|---|
| 17 | Stale root `storybook/*` path |
| 24 | Stale `@posthog/quill*` paths in `services/mcp` |
| 9 | Build chunks and `.node` binaries |
| 3 | `@shared/*.md` |
| 3 | Absolute `/static` in Rust fixtures |
| 1 | Import of a deleted module in an old migration |

Surface these in the explorer; do not drop them.

### 4. Module rule (recommended)

1. **Source-bearing folders only** (py, ts, js, and **rs**; Rust is folders only). Skip dot-folders and `node_modules`.
2. **Transparent `src`.** If `x/src` holds ≥ 80 % of `x`'s files, merge it into `x`. `frontend` then shows `scenes`, `lib`, `queries`, `layout`, `toolbar`; `nodejs` shows `ingestion`, `cdp`, `common`, `logs`; `rust/<crate>/src` is labeled `<crate>`.
3. **Compress single-child chains** that have no direct files. The label joins the path: `docs/onboarding`, `ee/management/commands`.
4. **One primary kind, by priority:** `product > package > layer > django-app > scene > tests > migrations > generated > python-package > directory`.
   - Product detection is generic: a folder with ≥ 10 children, where ≥ 60 % share ≥ 2 non-generic child names (`backend`, `frontend`), is a family. Its members are `product`, and those shared child folders are `layer`.
   - On PostHog it tags **exactly the 86 real products**. `desktop` (a nested workspace), `toolbar`, `inbox`, and `support/scripts` are correctly left out.
   - Looser thresholds mis-tag Rust crates and mobile feature folders.
5. **Tag `tests`, `migrations`, and `generated`; don't drop them.** **24 % of file edges (40,336 of 166,755) start in test files.** Hide tests by default in the explorer.

**Result:** 6,574 modules over 41,535 files. There are 16 top-level modules and the maximum depth is 10. Kinds: directory 3,845, tests 1,175, python-package 931, layer 151, package 146, scene 90, product 86, migrations 78, generated 67.

**Top two levels:**

| Top level | Kind | Files | Children (abridged) |
|---|---|---|---|
| `products` | python-package | 24,887 | 86 products + `desktop` [package] 4,939 + `toolbar` |
| `frontend` | package | 5,353 | `scenes` 3,027, `lib` 1,592, `queries` 251, `layout` 187, `toolbar` 126, `@posthog/lemon-ui` |
| `posthog` | django-app | 5,033 | 48 sub-packages: `models` 394, `clickhouse` 430, `hogql` 387, `api` 334, `migrations` 1,271, … |
| `nodejs` | package | 1,683 | `ingestion` 705, `cdp` 536, `common` 213, … |
| `rust` | package | 1,442 | 44 crates |
| `ee` | django-app | 888 | `hogai` 522, `api` 132, … |
| `services` | directory | 895 | `mcp` 644, `llm-gateway` 136, … |
| `packages` | directory | 469 | |
| `docs/onboarding` | package | 278 | |
| `tools` | directory | 246 | |
| `common` | python-package | 160 | |
| `cli`, `playwright`, `bin`, `funnel-udf/src`, `livestream/bot` | | small | |

**Top-level sibling edges:**

| Edge | Count |
|---|---|
| products → frontend | 14,982 |
| products → posthog | 13,794 |
| posthog → products | 1,976 |
| ee → posthog | 1,558 |
| frontend → products | 1,320 |
| products → packages | 740 |
| ee → products | 434 |
| docs/onboarding → frontend | 264 |
| products → ee | 192 |
| posthog → ee | 171 |

**`products/error_tracking`** (532 files):

- **Children:**

  | Child | Kind | Files | Contents |
  |---|---|---|---|
  | `backend` | layer | 220 | `facade`, `logic`, `presentation`, `hogql_queries`, `temporal`, `tasks`, `migrations`, `tests` |
  | `frontend` | layer | 297 | `components`, `scenes`, `logics`, `hooks`, … |
  | `dags` | | 4 | |
  | `mcp/apps` | | 7 | |

- **Siblings:** only `dags → backend: 2`. Frontend and backend talk over HTTP, which is the known cross-language gap.
- **Inside `backend`, the facade pattern is visible:**

  | Edge | Count |
  |---|---|
  | presentation → facade | 28 |
  | facade → logic | 8 |
  | facade → hogql_queries | 6 |
  | facade → temporal | 5 |
  | temporal → logic | 4 |

- **Inside `frontend`:** `scenes → components: 65` and `components → scenes: 11`, a cycle.
- **Outgoing:** `frontend/lib` 461, `frontend/scenes` 115, `frontend/queries` 114, `posthog/models` 99, `lemon-ui` 90.
- **Incoming:** `frontend/scenes` 25, `dashboards` 18, `posthog/clickhouse` 16.

**Ground truth: `tach.toml`.** Non-test Python edges lifted to tach's 94 modules (utility modules excluded) give **512 observed pairs, 508 declared (99.2 %)**. The 4 undeclared pairs are candidate real violations:

- `ee → products.slack_app`
- `access_control → event_definitions`
- `early_access_features → surveys`
- `event_definitions → ee`

44 declared pairs are unused.

**What the explorer must handle:**

- **Very wide folders:**

  | Folder | Children |
  |---|---|
  | `warehouse_sources/.../data_imports/sources` | 1,346 |
  | `frontend/src/lib/components` | 130 |
  | `products` | 90 |

  Show the top N and collapse the rest into "+N more".
- **Repeated labels** (`test`, `api`, `models`): qualify them with the parent.

### 5. Edge aggregation cost

View: root, `products`, and the top level expanded (290 visible modules). Lifting all 166,755 file edges takes **2.2 ms first run, 0.9 ms median**, producing 3,248 module edges. The method is a precomputed file→module `Int32Array` plus a memoized visible ancestor per module. Recompute on every interaction; no pre-aggregated tiers are needed.

### Recommendation for the real index

- **Extraction format (per blob, cached).**
  - Key: `(blob sha, extractor version)`.
  - Value: `ImportRef[] = { specifier, line, kind: static|type|lazy|reexport|dynamic|require, names? }`, with `names` only for Python `from … import`.
  - Use the new import-only extractor (`imports.ts`), not v1's `extractSourceFile`. Symbols and calls stay in the per-PR review.
- **Do not cache resolved targets.** Resolution is per snapshot, about 300 ms, and depends on the file set, tsconfigs, and manifests.
- **Storage.** `bun:sqlite` in the Git common dir, loaded into memory at server start. Parse misses in `min(cores, 8)` workers, each running `cat-file --batch` on chunks of 100.
- **Snapshot.** `cp <real index> <tmp>`, then `GIT_INDEX_FILE=<tmp> git add -A && git write-tree` (about 250 ms on PostHog). Never start from an empty index.
- **Resolver.** Keep v1's relative logic, add fixes 1–6, and drop the suffix heuristic.
- **Module rule** as in section 4.
- **Payload.** `modules[id,label,parent,kind,directFiles,totalFiles]`, `files[path,module,language]`, `edges[fromFile,toFile,kind]`. It is 6.7 MB for all of PostHog, so ship it whole and aggregate client-side.

Rerun the measurements with `prototype/repository-index/measure.sh cold|cache` and `bun prototype/repository-index/snapshot.ts`.

