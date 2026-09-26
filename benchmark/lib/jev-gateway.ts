import { experimental_evaluate as evaluate } from "ai";
import type { JevAnswer, JevClient } from "./jev.ts";

export const jevModel = "typesafe-ai/jev";

type EvaluateOptions = Parameters<typeof evaluate>[0];

const callTimeoutMs = 120_000;

export function gatewayJev(): JevClient {
  return {
    async evaluate(state, questions) {
      const result = await evaluate({
        model: jevModel,
        state: state as EvaluateOptions["state"],
        questions,
        abortSignal: AbortSignal.timeout(callTimeoutMs),
      });
      return result.answers as Record<string, JevAnswer>;
    },
  };
}
