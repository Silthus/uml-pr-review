import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { gatewayJev } from "../benchmark/lib/jev-gateway.ts";
import { correctionCandidates } from "./lib/corrections.ts";
import { gh, rawContent } from "./lib/gh.ts";
import { DropLedger, type Harvest, type HarvestItem } from "./lib/items.ts";
import { closedUnmergedPullRequestNumbers, mergedPullRequestNumbers, pullRequestFeedback } from "./lib/pull-requests.ts";
import { keepConstrainingTurns } from "./lib/relevance.ts";
import { filesUnder, headCommit } from "./lib/repository.ts";
import { pullRequestFeedbackSchema, reviewFeedback } from "./lib/review-feedback.ts";
import { defaultSessionLocations, userTurns } from "./lib/sessions.ts";
import { ancestorGuidancePaths, configStatements, documentStatements, isGuidanceDocument, moduleNamesOf, statementItems } from "./lib/written-rules.ts";

const optionsSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  scope: z.array(z.string().min(1)).min(1),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  out: z.string().min(1),
  term: z.array(z.string()).default([]),
  config: z.array(z.string()).default(["tach.toml", "pyproject.toml", ".importlinter", ".oxlintrc.json", "eslint.config.mjs", ".eslintrc.js", ".semgrep.yml", "CODEOWNERS", ".github/CODEOWNERS"]),
  jev: z.boolean().default(true),
});
type Options = z.infer<typeof optionsSchema>;

const crawlSchema = z.object({ key: z.string(), merged: z.array(z.number().int()), closed: z.array(z.number().int()), feedback: z.array(pullRequestFeedbackSchema) });
type Crawl = z.infer<typeof crawlSchema>;

const usage = "Usage: bun harvest/run.ts --repo owner/name --scope <path> [--scope <path>] --since YYYY-MM-DD --out <dir> [--term <word>] [--config <root file>] [--no-jev]";

const options = parseOptions();
const drops = new DropLedger();
const collected: Record<string, number> = {};
const commit = await headCommit(options.repo);
const terms = options.term.length > 0 ? options.term : options.scope.map((scope) => basename(scope));

await mkdir(options.out, { recursive: true });
const reviewItems = await harvestReviews(options);
const sessionCandidates = await harvestSessions(options);
const docItems = await harvestWrittenRules(options);
const { sessionItems, relevanceFilter } = await filterSessions(sessionCandidates);

const harvest: Harvest = { repo: options.repo, scopes: options.scope, since: options.since, commit, harvestedAt: new Date().toISOString(), relevanceFilter, collected, drops: drops.entries(), items: [...reviewItems, ...sessionItems, ...docItems] };
await Bun.write(join(options.out, "harvest.json"), `${JSON.stringify(harvest, null, 2)}\n`);
console.log(`Harvested ${harvest.items.length} items into ${join(options.out, "harvest.json")}`);
console.log(JSON.stringify(countBy(harvest.items), null, 2));

async function harvestReviews(options: Options): Promise<HarvestItem[]> {
  const { merged, closed, feedback } = await cachedCrawl(options);
  collected["merged pull requests touching the scope"] = merged.length;
  collected["closed, unmerged pull requests touching the scope"] = closed.length;
  collected["inline review comments on those pull requests"] = feedback.reduce((sum, pr) => sum + pr.reviewThreads.nodes.reduce((threads, { comments }) => threads + comments.nodes.length, 0), 0);
  collected["non-empty review bodies on those pull requests"] = feedback.reduce((sum, pr) => sum + pr.reviews.nodes.filter(({ body }) => body.trim().length > 0).length, 0);
  return feedback.flatMap((pullRequest) => reviewFeedback(pullRequest, { scopes: options.scope, since: options.since }, drops));
}

async function cachedCrawl({ repo, scope, since, out }: Options): Promise<Crawl> {
  const cache = Bun.file(join(out, "pull-requests.json"));
  const key = JSON.stringify({ repo, scope, since, terms });
  const cached = (await cache.exists()) ? crawlSchema.safeParse(await cache.json()) : undefined;
  if (cached?.success && cached.data.key === key) return cached.data;
  const merged = new Set<number>();
  for (const path of scope) for (const number of await mergedPullRequestNumbers(repo, path, since)) merged.add(number);
  const closed = (await closedUnmergedPullRequestNumbers(repo, scope, since, terms)).filter((number) => !merged.has(number));
  const numbers = [...merged, ...closed];
  const feedback = await pullRequestFeedback(repo, numbers, (done) => console.error(`review feedback: ${done}/${numbers.length} pull requests`));
  const crawl = { key, merged: [...merged], closed, feedback };
  await Bun.write(cache, JSON.stringify(crawl));
  return crawl;
}

async function filterSessions(candidates: HarvestItem[]): Promise<{ sessionItems: HarvestItem[]; relevanceFilter: string }> {
  if (!options.jev || !process.env.AI_GATEWAY_API_KEY) return { sessionItems: candidates, relevanceFilter: "heuristics only; Jev was not available" };
  const { kept, classified } = await keepConstrainingTurns(candidates, gatewayJev(), drops);
  return { sessionItems: kept, relevanceFilter: `Jev classified ${classified} of ${candidates.length} session turns; review comments go to clustering unfiltered` };
}

async function harvestSessions({ repo }: Options): Promise<HarvestItem[]> {
  const hint = repo.split("/")[1]?.toLowerCase() ?? repo;
  const turns = await userTurns(defaultSessionLocations(), hint);
  for (const turn of turns) count(`${turn.source} user turns in ${hint} sessions`);
  const author = await gh(["api", "user"], z.object({ login: z.string() }));
  return correctionCandidates(turns, terms, author.login, drops);
}

async function harvestWrittenRules({ repo, scope, config }: Options): Promise<HarvestItem[]> {
  const items: HarvestItem[] = [];
  const documents = (await Promise.all(scope.map((path) => filesUnder(repo, commit, path)))).flat().filter(isGuidanceDocument);
  const ancestors = [...new Set(scope.flatMap(ancestorGuidancePaths))];
  for (const path of [...ancestors, ...documents]) {
    const text = await rawContent(repo, `${path}?ref=${commit}`);
    if (text === null) continue;
    count(ancestors.includes(path) ? "agent guides above the scope" : "guidance documents in the scope");
    items.push(...statementItems(repo, commit, path, documentStatements(text)));
  }
  const moduleNames = scope.flatMap(moduleNamesOf);
  for (const path of config) {
    const text = await rawContent(repo, `${path}?ref=${commit}`);
    if (text === null) continue;
    count("root config files read");
    items.push(...statementItems(repo, commit, path, configStatements(path, text, moduleNames)));
  }
  return items;
}

function parseOptions(): Options {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { repo: { type: "string" }, scope: { type: "string", multiple: true }, since: { type: "string" }, out: { type: "string" }, term: { type: "string", multiple: true }, config: { type: "string", multiple: true }, "no-jev": { type: "boolean" } },
  });
  const parsed = optionsSchema.safeParse({ ...values, jev: !values["no-jev"] });
  if (!parsed.success) {
    console.error(`${usage}\n${z.prettifyError(parsed.error)}`);
    process.exit(1);
  }
  return parsed.data;
}

function count(what: string): void {
  collected[what] = (collected[what] ?? 0) + 1;
}

function countBy(items: readonly HarvestItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, { source }) => ({ ...counts, [source]: (counts[source] ?? 0) + 1 }), {});
}
