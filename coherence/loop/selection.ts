import type { Factor } from "../signals/factors.ts";
import type { Target } from "../signals/rank.ts";
import type { RecipeStep } from "../signals/recipe.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { ChosenTarget, Question, QuestionDraft, Sense } from "./state.ts";

export type Choice =
  | { action: "act"; target: ChosenTarget; answer: Question | null }
  | { action: "ask"; target: ChosenTarget; question: QuestionDraft }
  | { action: "done"; reason: string };

const evidenceShown = 8;

const stepQuestions: Record<RecipeStep, string> = {
  facade: "put a facade in front of",
  "characterisation-tests": "pin the current behaviour with characterisation tests in",
  "ratchet-rule": "ratchet a rule, with today's violations as the baseline, over",
  "internal-cleanup": "clean up the internals of",
};

export function chooseNext(sense: Sense, ledger: LedgerEntry[], heldModules: ReadonlySet<string>): Choice {
  const thisRun = ledger.filter(({ sense: id }) => id === sense.id);
  const proposed = thisRun.filter(({ outcome }) => outcome === "proposed").length;
  if (proposed >= sense.budget) return { action: "done", reason: `budget spent: ${proposed} of ${sense.budget} pull requests proposed` };
  const asked = thisRun.filter(({ outcome }) => outcome === "question").length;
  for (const target of sense.report.targets.filter(({ score }) => score > 0)) {
    const { module } = target;
    const { step, verification } = target.recommendation;
    if (heldModules.has(module) || isHandledInThisRun(sense, ledger, module) || hasOpenQuestion(sense, module)) continue;
    const answer = answerFor(sense, module, step);
    if (answer?.answer === null) continue;
    if (verification === "boundary" && answer === undefined) {
      if (asked < sense.maxQuestions) return { action: "ask", target: chosen(target), question: questionFor(sense, target) };
      continue;
    }
    return { action: "act", target: chosen(target), answer: answer ?? null };
  }
  return { action: "done", reason: "no targets left: every ranked module is handled, busy, waiting on a question, or has no score" };
}

function isHandledInThisRun(sense: Sense, ledger: LedgerEntry[], module: string): boolean {
  return ledger.some((entry) => entry.scope === sense.scope && entry.module === module && entry.sense === sense.id);
}

function hasOpenQuestion(sense: Sense, module: string): boolean {
  return sense.questions.some((question) => question.state === "open" && question.scope === sense.scope && question.module === module);
}

function answerFor(sense: Sense, module: string, step: string): Question | undefined {
  return sense.questions
    .filter((question) => question.state === "resolved" && question.scope === sense.scope && question.module === module && question.step === step)
    .sort((a, b) => b.number - a.number)[0];
}

function chosen({ rank, module, score, busyFiles, factors, recommendation }: Target): ChosenTarget {
  return {
    rank,
    module,
    score,
    step: recommendation.step,
    verification: recommendation.verification,
    reason: recommendation.reason,
    evidence: [factors.pressure, factors.pain, factors.safety].flatMap(evidenceOf).slice(0, evidenceShown),
    busyFiles,
  };
}

function evidenceOf({ components }: Factor): string[] {
  return components.flatMap(({ name, evidence }) => evidence.map((item) => `${name}: ${item}`));
}

function questionFor(sense: Sense, target: Target): QuestionDraft {
  const { module, rank, score, recommendation } = target;
  const evidence = chosen(target).evidence;
  return {
    title: `Coherence: ${recommendation.step} for ${module}?`,
    question: `Should the coherence loop ${stepQuestions[recommendation.step]} \`${module}\`? It is a ${recommendation.verification} decision, so it waits for a human.`,
    context: [
      `Rank ${rank} of ${sense.report.targets.length} in \`${sense.scope}\` at ${sense.base.ref} (${sense.base.commit.slice(0, 12)}), score ${(100 * score).toFixed(2)}.`,
      `Recommendation: ${recommendation.reason}`,
      ...(evidence.length > 0 ? ["Evidence:", ...evidence.map((item) => `- ${item}`)] : []),
    ].join("\n"),
    options: [
      `Approve: go ahead with the ${recommendation.step} as recommended.`,
      "Amend: go ahead, with the boundary, name, or owner given in the answer.",
      `Skip: leave \`${module}\` alone; the loop moves on.`,
    ],
    raised: null,
  };
}
