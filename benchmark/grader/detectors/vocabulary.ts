import { Glob } from "bun";
import { join, resolve } from "node:path";
import { z } from "zod";
import { renamesOf, versionsOn, type FileVersion, type Side } from "../change.ts";
import type { Detector } from "../context.ts";
import { difference, type Violation } from "../violations.ts";

export type TermFile = { product: string; scopes: string[]; avoid: string[] };

const HarvestedRulesSchema = z.object({
  product: z.string(),
  source: z.object({ scopes: z.array(z.string()) }),
  vocabulary: z.array(z.object({ term: z.string(), avoid: z.array(z.string()) })),
});

const vocabularyFiles = /\.(py|[mc]?[jt]sx?|ya?ml|md)$/;

export const vocabulary: Detector = async (context) => {
  const termFiles = await readTermFiles(resolve(import.meta.dir, "..", "..", "..", context.config.vocabulary.termFiles));
  const violationsOn = (side: Side) => versionsOn(context.change, side).flatMap((version) => termViolations(version, termFiles));
  return difference(violationsOn("before"), violationsOn("after"), renamesOf(context.change));
};

async function readTermFiles(directory: string): Promise<TermFile[]> {
  const files: TermFile[] = [];
  for await (const path of new Glob("*/rules.json").scan({ cwd: directory })) {
    const rules = HarvestedRulesSchema.parse(await Bun.file(join(directory, path)).json());
    files.push({ product: rules.product, scopes: rules.source.scopes.map((scope) => `${scope.replace(/\/$/, "")}/`), avoid: checkableTerms(rules.vocabulary.flatMap(({ avoid }) => avoid)) });
  }
  return files;
}

function termViolations(version: FileVersion, termFiles: TermFile[]): Violation[] {
  if (!vocabularyFiles.test(version.path)) return [];
  const terms = termFiles.filter(({ scopes }) => scopes.some((scope) => version.path.startsWith(scope))).flatMap(({ avoid }) => avoid);
  if (terms.length === 0) return [];
  return version.text.split("\n").flatMap((text, index) => {
    const words = wordsOf(text);
    return terms.flatMap((term) => occurrences(words, term).map((): Violation => ({ detector: "vocabulary", rule: "avoided-term", file: version.path, line: index + 1, subject: term, message: `"${term}" is a term to avoid in ${version.path}` })));
  });
}

function checkableTerms(avoid: string[]): string[] {
  const spelled = avoid.filter((term) => !/[()]/.test(term)).map((term) => term.toLowerCase().trim());
  const compound = new Set(spelled.filter((term) => term.includes(" ")).map((term) => term.replaceAll(" ", "")));
  return [...new Set(spelled.filter((term) => term.includes(" ") || compound.has(term)).map((term) => term.replaceAll(" ", "")))];
}

function wordsOf(text: string): string[] {
  return text
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function occurrences(words: string[], term: string): number[] {
  const found: number[] = [];
  for (let start = 0; start < words.length; start++) {
    let joined = "";
    for (let end = start; end < words.length && joined.length < term.length; end++) {
      joined += words[end];
      if (joined === term) found.push(start);
    }
  }
  return found;
}
