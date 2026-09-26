import { createHash } from "node:crypto";
import { isTestPath } from "../../src/analyzer/extract.ts";
import { mean, round } from "./metric-scores.ts";
import type { PatchedFile } from "./patch.ts";

export type JevQuestion = { type: "boolean"; instructions: string; criteria: { true: string; false: string } } | { type: "score"; instructions: string; criteria: string[] };
export type JevAnswer = { type: "boolean"; probability: number } | { type: "score"; score: number };
export type Questions = Record<string, JevQuestion>;

export interface JevClient {
  evaluate(state: unknown, questions: Questions): Promise<Record<string, JevAnswer>>;
}

export type GradedUnit = { subject: string; answers: Record<string, number> };
export type SkippedUnit = { subject: string; reason: string };
export type JevGrade = { files: GradedUnit[]; tests: GradedUnit[]; diff: GradedUnit; skipped: SkippedUnit[]; fileQuality: number | null; score: number };
export type JevReport = { status: "graded"; model: string; gradedAt: string; runs: Record<string, JevGrade>; skipped: Record<string, string> } | { status: "unavailable"; reason: string };

const contextLines = 60;
const diffBudget = 16_000;
const contextBudget = 12_000;

export const productionFileQuestions: Questions = {
  readability: score("How easy is the changed code in this file to read for a developer who knows the codebase?", [
    "Hard to follow: long or tangled functions, unclear flow, surprising tricks.",
    "Readable with effort: the intent is recoverable, but some functions are long or the flow jumps around.",
    "Readable: short functions and a clear flow, with a few spots that need a second look.",
    "Reads like prose: small, well-named functions whose flow is obvious at a glance.",
  ]),
  singleResponsibility: boolean("Does each function and class the change adds or changes in this file do one thing?", {
    true: "Every added or changed function and class has one clear job; nothing mixes unrelated concerns such as I/O, business rules, and formatting.",
    false: "At least one added or changed function or class does several unrelated jobs that should be split.",
  }),
  namingClarity: score("How clearly do the names the change introduces in this file say what they are or do?", [
    "Misleading or meaningless names (tmp, data2, handle) for important things.",
    "Vague names that need the body to understand.",
    "Clear names, with one or two that could be more precise.",
    "Every name states its intent precisely in the codebase's vocabulary.",
  ]),
  errorHandling: score("Is the error handling of the changed code appropriate to its context?", [
    "Errors are swallowed, or failures that callers need to know about are hidden.",
    "Some failure paths are unhandled or handled too broadly (a bare except, a catch-all).",
    "Failures are handled or propagated sensibly, with a minor gap.",
    "Every failure path is handled at the right level: validated at boundaries, propagated where callers decide, nothing swallowed.",
  ]),
  idiomaticFit: score("Does the change fit the idioms and conventions of the surrounding code in this file?", [
    "Clashes with the surrounding code: a different style, structure, or framework usage.",
    "Partly fits, with noticeable deviations from local conventions.",
    "Fits the local conventions with minor deviations.",
    "Indistinguishable from well-written surrounding code: the same patterns, helpers, and style.",
  ]),
};

export const testFileQuestions: Questions = {
  assertsBehaviour: boolean("Do the tests the change adds or changes in this file assert observable behaviour rather than implementation details?", {
    true: "The tests exercise public entry points and assert outcomes a caller can observe.",
    false: "The tests mostly assert internals: private helpers, call counts on mocks, or the exact structure of the implementation.",
  }),
  edgeCases: score("How well do the tests the change adds or changes cover edge cases?", [
    "Only the happy path, or no meaningful assertions.",
    "The happy path plus one obvious edge case.",
    "Several relevant edge cases, such as empty input, missing data, or permissions.",
    "The edge cases that matter for this behaviour are covered systematically, including failure paths.",
  ]),
};

export const diffQuestions: Questions = {
  testsCoverBehaviour: score("Do the tests in this diff cover the new behaviour the task asks for?", [
    "No tests for the new behaviour.",
    "Tests touch the new behaviour only superficially.",
    "Tests cover the main new behaviour, with gaps.",
    "Tests cover the new behaviour thoroughly, including its important edge cases.",
  ]),
  staysOnTask: boolean("Does the diff stay on the task, without unrelated edits?", {
    true: "Every change serves the task statement; there are no drive-by refactors, unrelated fixes, or stray files.",
    false: "The diff contains edits unrelated to the task statement.",
  }),
  explicitInterfaces: score("How explicit are the interfaces between modules that the diff adds or uses?", [
    "Modules reach into each other's internals; no deliberate interface.",
    "Some calls go through an interface, others reach past it.",
    "Cross-module calls go through a named interface, with small leaks.",
    "Every cross-module interaction goes through a narrow, explicit, typed interface.",
  ]),
};

export async function gradeDiff(client: JevClient, taskStatement: string, patch: string, files: PatchedFile[], contentOf: (path: string) => Promise<string>): Promise<JevGrade> {
  const changed = files.filter(({ status, hunks }) => status !== "deleted" && hunks.length > 0);
  const production = changed.filter(({ path }) => !isTestPath(path));
  const tests = changed.filter(({ path }) => isTestPath(path));
  const skipped: SkippedUnit[] = [];
  const gradeFiles = async (subjects: PatchedFile[], questions: Questions) => {
    const units: GradedUnit[] = [];
    for (const file of subjects) {
      const unit = await grade(client, file.path, fileState(file, await contentOf(file.path)), questions).catch((error: unknown) => skipOversized(error, file.path, skipped));
      if (unit) units.push(unit);
    }
    return units;
  };
  const graded = {
    files: await gradeFiles(production, productionFileQuestions),
    tests: await gradeFiles(tests, testFileQuestions),
    diff: await grade(client, "diff", { task: taskStatement, diff: truncated(patch) }, diffQuestions),
  };
  const fileAnswers = graded.files.flatMap(({ answers }) => Object.values(answers));
  const allAnswers = [...fileAnswers, ...graded.tests.flatMap(({ answers }) => Object.values(answers)), ...Object.values(graded.diff.answers)];
  return { ...graded, skipped, fileQuality: fileAnswers.length > 0 ? round(100 * mean(fileAnswers)) : null, score: round(100 * mean(allAnswers)) };
}

export function cachedClient(client: JevClient, cache: Map<string, Record<string, JevAnswer>>): JevClient {
  return {
    async evaluate(state, questions) {
      const key = fingerprint({ state, questions });
      const cached = cache.get(key);
      if (cached) return cached;
      const answers = await client.evaluate(state, questions);
      cache.set(key, answers);
      return answers;
    },
  };
}

export type RetryPolicy = { attempts: number; delayMs: (attempt: number) => number; sleep: (ms: number) => Promise<void> };

const transientGatewayError = /temporarily unavailable|high demand|rate.?limit|too many requests|timed? ?out|\b50[234]\b|internal ?server ?error/i;

export const patientRetry: RetryPolicy = { attempts: 6, delayMs: (attempt) => Math.min(60_000, 5_000 * 2 ** attempt), sleep: Bun.sleep };

export function retryingClient(client: JevClient, policy: RetryPolicy = patientRetry): JevClient {
  return {
    async evaluate(state, questions) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.evaluate(state, questions);
        } catch (error) {
          if (attempt + 1 >= policy.attempts || !transientGatewayError.test(String(error))) throw error;
          await policy.sleep(policy.delayMs(attempt));
        }
      }
    },
  };
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

async function grade(client: JevClient, subject: string, state: unknown, questions: Questions): Promise<GradedUnit> {
  const answers = await client.evaluate(state, questions);
  return { subject, answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, normalized(question, answers[id])])) };
}

function normalized(question: JevQuestion, answer: JevAnswer | undefined): number {
  if (!answer) throw new Error(`Jev did not answer ${question.instructions}`);
  if (answer.type === "boolean") return round(answer.probability, 2);
  const levels = question.type === "score" ? question.criteria.length : 2;
  return round(answer.score / (levels - 1), 2);
}

function fileState(file: PatchedFile, content: string) {
  const lines = content.split("\n");
  const first = Math.min(...file.hunks.map(({ start }) => start));
  const last = Math.max(...file.hunks.map(({ start, length }) => start + length));
  const from = Math.max(0, first - 1 - contextLines);
  return { path: file.path, status: file.status, diff: truncated(file.section), context: { fromLine: from + 1, code: truncated(lines.slice(from, last + contextLines).join("\n"), contextBudget) } };
}

function truncated(text: string, budget = diffBudget): string {
  return text.length <= budget ? text : `${text.slice(0, budget)}\n[truncated: showing ${budget} of ${text.length} characters]`;
}

const oversizedRequest = /max_tokens_exceeded|status 400|context length|too long/i;

function skipOversized(error: unknown, subject: string, skipped: SkippedUnit[]): undefined {
  if (!oversizedRequest.test(String(error))) throw error;
  skipped.push({ subject, reason: String(error instanceof Error ? error.message : error).slice(0, 200) });
  return undefined;
}

function score(instructions: string, criteria: string[]): JevQuestion {
  return { type: "score", instructions, criteria };
}

function boolean(instructions: string, criteria: { true: string; false: string }): JevQuestion {
  return { type: "boolean", instructions, criteria };
}
