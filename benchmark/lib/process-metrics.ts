import type { TraceEvent } from "./trace.ts";

export type ProcessMetrics = {
  toolCalls: number;
  edits: number;
  toolCallsBeforeFirstEdit: number;
  secondsBeforeFirstEdit: number | null;
  architectureToolCalls: number;
  architectureExplorationBeforeEdit: number;
  architectureReasoningBeforeEdit: number;
  firstArchitectureThought: string | null;
};

const architectureTool = /^mcp__uml-pr-review__/;
const architectureSources = /architecture\.md|tach\.toml|\/facade\b|\bfacade\//;
const architectureVocabulary = /\b(seams?|facades?|interfaces?|boundar(?:y|ies)|modules?|coupling|cohesion|contracts?|layers?)\b/i;

export function processMetrics(trace: TraceEvent[], startedAt?: number): ProcessMetrics {
  const firstEdit = trace.findIndex((event) => event.kind === "tool" && event.edit);
  const beforeEdit = firstEdit === -1 ? trace : trace.slice(0, firstEdit);
  const tools = trace.filter((event) => event.kind === "tool");
  const thoughts = beforeEdit.flatMap((event) => (event.kind === "text" && architectureVocabulary.test(event.text) ? [event.text] : []));
  return {
    toolCalls: tools.length,
    edits: tools.filter((event) => event.edit).length,
    toolCallsBeforeFirstEdit: beforeEdit.filter((event) => event.kind === "tool").length,
    secondsBeforeFirstEdit: secondsBetween(startedAt ?? firstPromptTime(trace), firstEdit === -1 ? undefined : trace[firstEdit]!.at),
    architectureToolCalls: tools.filter((event) => architectureTool.test(event.name)).length,
    architectureExplorationBeforeEdit: beforeEdit.filter(isArchitectureExploration).length,
    architectureReasoningBeforeEdit: thoughts.length,
    firstArchitectureThought: thoughts[0] ? sentenceAround(thoughts[0]) : null,
  };
}

function isArchitectureExploration(event: TraceEvent): boolean {
  return event.kind === "tool" && !event.edit && (architectureTool.test(event.name) || architectureSources.test(JSON.stringify(event.input ?? "")));
}

function firstPromptTime(trace: TraceEvent[]): number | undefined {
  return (trace.find((event) => event.kind === "prompt") ?? trace[0])?.at;
}

function secondsBetween(start: number | undefined, end: number | undefined): number | null {
  return start === undefined || end === undefined ? null : Math.round((end - start) / 1000);
}

function sentenceAround(text: string): string {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const sentence = sentences.find((candidate) => architectureVocabulary.test(candidate)) ?? sentences[0]!;
  return sentence.length > 300 ? `${sentence.slice(0, 297)}...` : sentence;
}
