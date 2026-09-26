import type { JevClient, JevQuestion, Questions } from "../../benchmark/lib/jev.ts";
import type { DropLedger, HarvestItem } from "./items.ts";

const batchSize = 5;
const threshold = 0.5;
const messageBudget = 3000;

function constrainsCode(key: string): JevQuestion {
  return {
    type: "boolean",
    instructions: `A developer wrote message ${key} in the state to their coding agent. Judge only message ${key}. Does it correct or constrain how the agent writes code, places code, or structures the architecture?`,
    criteria: {
      true: "It tells the agent what code to write or not write, where code belongs, which module, layer, API, or pattern to use or avoid, or rejects a design the agent chose.",
      false: "It is about process only: status, git, pull requests, CI, reviews, scheduling, research, writing prose, or a plain question without a constraint on code.",
    },
  };
}

export type RelevanceOutcome = { kept: HarvestItem[]; classified: number };

export async function keepConstrainingTurns(items: readonly HarvestItem[], client: JevClient, drops: DropLedger): Promise<RelevanceOutcome> {
  const kept: HarvestItem[] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const keys = batch.map((_, index) => `m${index}`);
    const state = { messages: Object.fromEntries(batch.map((item, index) => [keys[index], item.body.slice(0, messageBudget)])) };
    const questions: Questions = Object.fromEntries(keys.map((key) => [key, constrainsCode(key)]));
    const answers = await client.evaluate(state, questions).catch(() => undefined);
    if (!answers) return { kept: [...kept, ...items.slice(start)], classified: start };
    batch.forEach((item, index) => {
      const answer = answers[keys[index] ?? ""];
      if (answer?.type === "boolean" && answer.probability < threshold) drops.record("session", "Jev: process chatter, no constraint on code");
      else kept.push(item);
    });
  }
  return { kept, classified: items.length };
}
