import { complexThreshold } from "./factors.ts";
import type { ModuleState } from "./modules.ts";
import type { ConfigMention } from "./ratchets.ts";
import { enforcedLevels, findingSources, type HarvestedRule } from "./rules.ts";

export type RecipeStep = "facade" | "characterisation-tests" | "ratchet-rule" | "internal-cleanup";
export type VerificationClass = "mechanical" | "behaviour-adjacent" | "boundary";
export type Recommendation = { step: RecipeStep; verification: VerificationClass; reason: string };
export type RecipeState = { module: ModuleState; rules: HarvestedRule[]; mentions: ConfigMention[] };

export const characterisedShare = 0.5;
const listed = 3;

export function nextStep(state: RecipeState): Recommendation {
  return facadeStep(state) ?? characterisationStep(state) ?? ratchetStep(state) ?? cleanupStep(state);
}

function facadeStep({ module }: RecipeState): Recommendation | null {
  const bypasses = module.inboundBypasses;
  if (bypasses.length === 0) return null;
  return {
    step: "facade",
    verification: "boundary",
    reason: `${bypasses.length} imports from other products bypass the facade into this module: ${bypasses.slice(0, listed).map(({ from, to }) => `${from} -> ${to}`).join("; ")}`,
  };
}

function characterisationStep({ module }: RecipeState): Recommendation | null {
  if (module.uncoveredFacadeFunctions.length > 0) {
    return {
      step: "characterisation-tests",
      verification: "mechanical",
      reason: `no test references ${module.uncoveredFacadeFunctions.length} facade functions: ${module.uncoveredFacadeFunctions.slice(0, listed).join(", ")}`,
    };
  }
  if (module.testedFiles.length >= characterisedShare * module.files.length) return null;
  return {
    step: "characterisation-tests",
    verification: "mechanical",
    reason: `tests import ${module.testedFiles.length} of ${module.files.length} files; untested: ${module.untestedFiles.slice(0, listed).join(", ")}`,
  };
}

function ratchetStep({ module, rules, mentions }: RecipeState): Recommendation | null {
  if (rules.some(({ currentLevel }) => enforcedLevels.has(currentLevel)) || mentions.length > 0) return null;
  const candidate = rules
    .filter(({ proposedLevel }) => enforcedLevels.has(proposedLevel))
    .sort((a, b) => findings(b) - findings(a) || a.id.localeCompare(b.id))[0];
  if (candidate) {
    return {
      step: "ratchet-rule",
      verification: candidate.kind === "boundary" ? "boundary" : "mechanical",
      reason: `ratchet ${candidate.id} (${candidate.currentLevel} -> ${candidate.proposedLevel}) with today's violations as the baseline: ${candidate.statement}`,
    };
  }
  return {
    step: "ratchet-rule",
    verification: "mechanical",
    reason: `no rule or baseline covers this module; ratchet complexity at CCN ${complexThreshold} with today's offenders as the baseline${topDriver(module)}`,
  };
}

function cleanupStep({ module, rules, mentions }: RecipeState): Recommendation {
  const ratchets = [...rules.filter(({ currentLevel }) => enforcedLevels.has(currentLevel)).map(({ id, currentLevel }) => `${id} (${currentLevel})`), ...mentions.map(({ source }) => source)];
  return {
    step: "internal-cleanup",
    verification: "behaviour-adjacent",
    reason: `already held by ${ratchets.slice(0, listed).join(", ")}; simplify the internals${topDriver(module)}`,
  };
}

function topDriver({ complexity }: ModuleState): string {
  const driver = complexity.drivers[0];
  return driver ? `, starting with ${driver.file}:${driver.function} (CCN ${driver.ccn})` : "";
}

function findings(rule: HarvestedRule): number {
  return rule.evidence.filter(({ source }) => findingSources.has(source)).length;
}
