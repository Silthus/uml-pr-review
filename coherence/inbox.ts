#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { z } from "zod";
import { run } from "../src/git.ts";
import { emit, usageError } from "./loop/cli.ts";
import { readIteration, writeIteration, type Question, type QuestionDraft } from "./loop/state.ts";

export const inboxRepository = "Silthus/uml-pr-review";
export const questionLabel = "coherence:question";

export type QuestionSubject = { scope: string; module: string; step: string; iteration: string };

const usage = [
  "Usage: bun coherence/inbox.ts raise --iteration <dir> [--question <text>] [--context <text>] [--option <text>]...",
  "       bun coherence/inbox.ts list [--state open|resolved|all]",
  "       bun coherence/inbox.ts resolve <number> --answer <text>",
].join("\n");

const subjectMarker = /<!-- coherence-question (\{.*\}) -->/;
const SubjectSchema = z.object({ scope: z.string(), module: z.string(), step: z.string(), iteration: z.string() });
const IssuesSchema = z.array(
  z.object({ number: z.number().int(), url: z.string(), title: z.string(), state: z.string(), body: z.string(), comments: z.array(z.object({ body: z.string() })) }),
);
const optionLetters = "ABCDEFGHIJ";

export async function listQuestions(): Promise<Question[]> {
  const output = await gh(["issue", "list", "--label", questionLabel, "--state", "all", "--limit", "500", "--json", "number,url,title,state,body,comments"]);
  return IssuesSchema.parse(JSON.parse(output)).flatMap((issue) => {
    const subject = subjectOf(issue.body);
    if (subject === null) return [];
    const resolved = issue.state.toUpperCase() === "CLOSED";
    return [{ number: issue.number, url: issue.url, title: issue.title, scope: subject.scope, module: subject.module, step: subject.step, state: resolved ? "resolved" : "open", answer: resolved ? answerOf(issue) : null }];
  });
}

export async function raiseQuestion(subject: QuestionSubject, draft: QuestionDraft): Promise<{ number: number; url: string }> {
  await gh(["label", "create", questionLabel, "--color", "5319E7", "--description", "A question the coherence loop cannot answer alone", "--force"]);
  const url = (await gh(["issue", "create", "--title", draft.title, "--label", questionLabel, "--body-file", "-"], questionBody(subject, draft))).trim();
  const number = Number(/\/issues\/(\d+)$/.exec(url)?.[1]);
  if (!Number.isInteger(number)) throw new Error(`gh issue create printed no issue URL: ${url}`);
  return { number, url };
}

export async function resolveQuestion(number: number, answer: string): Promise<void> {
  await gh(["issue", "comment", String(number), "--body-file", "-"], answer);
  await gh(["issue", "close", String(number)]);
}

export function questionBody(subject: QuestionSubject, { question, context, options }: QuestionDraft): string {
  return [
    question,
    "",
    "## Context",
    "",
    context,
    "",
    "## Options",
    "",
    ...options.map((option, index) => `- [ ] ${optionLetters[index]}. ${option}`),
    "",
    `Answer with a comment naming the option and any detail, then close the issue. Or run \`bun coherence/inbox.ts resolve <number> --answer "<answer>"\`. The next loop iteration reads the answer.`,
    "",
    `<!-- coherence-question ${JSON.stringify(subject)} -->`,
  ].join("\n");
}

function subjectOf(body: string): QuestionSubject | null {
  const marker = subjectMarker.exec(body)?.[1];
  if (marker === undefined) return null;
  const parsed = SubjectSchema.safeParse(JSON.parse(marker));
  return parsed.success ? parsed.data : null;
}

function answerOf({ body, comments }: z.infer<typeof IssuesSchema>[number]): string | null {
  const comment = comments.at(-1)?.body.trim();
  if (comment) return comment;
  const ticked = body.split("\n").filter((line) => /^- \[x\] /i.test(line));
  return ticked.length > 0 ? ticked.map((line) => line.slice(6)).join("\n") : null;
}

function gh(args: string[], stdin?: string): Promise<string> {
  return run(import.meta.dir, ["gh", ...args, "--repo", inboxRepository], stdin);
}

async function raiseFromIteration(directory: string, overrides: { question?: string; context?: string; option?: string[] }) {
  const iteration = await readIteration(directory);
  if (iteration.question?.raised) throw new Error(`${directory} already raised ${iteration.question.raised.url}`);
  const draft = mergedDraft(iteration.question, iteration.target.module, iteration.target.step, overrides);
  const raised = await raiseQuestion({ scope: iteration.scope, module: iteration.target.module, step: iteration.target.step, iteration: directory }, draft);
  await writeIteration(directory, { ...iteration, question: { ...draft, raised } });
  return raised;
}

function mergedDraft(draft: QuestionDraft | null, module: string, step: string, overrides: { question?: string; context?: string; option?: string[] }): QuestionDraft {
  const question = overrides.question ?? draft?.question;
  const context = overrides.context ?? draft?.context;
  const options = overrides.option && overrides.option.length > 0 ? overrides.option : draft?.options;
  if (!question || !context || !options || options.length < 2) throw new Error("this iteration has no drafted question; pass --question, --context, and at least two --option");
  return { title: draft?.title ?? `Coherence: ${step} for ${module}?`, question, context, options, raised: null };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      iteration: { type: "string" },
      question: { type: "string" },
      context: { type: "string" },
      option: { type: "string", multiple: true },
      state: { type: "string", default: "open" },
      answer: { type: "string" },
    },
  });
  const [command, number] = positionals;
  if (command === "raise" && values.iteration) return emit(() => raiseFromIteration(values.iteration!, values));
  if (command === "list" && ["open", "resolved", "all"].includes(values.state)) {
    return emit(async () => (await listQuestions()).filter(({ state }) => values.state === "all" || state === values.state));
  }
  if (command === "resolve" && Number.isInteger(Number(number)) && values.answer) {
    return emit(async () => (await resolveQuestion(Number(number), values.answer!), { resolved: Number(number) }));
  }
  usageError(usage);
}

if (import.meta.main) await main();
