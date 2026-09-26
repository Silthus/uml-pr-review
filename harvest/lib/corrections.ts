import type { DropLedger, HarvestItem } from "./items.ts";
import type { UserTurn } from "./sessions.ts";

const injectedBlock = /<(recommended_plugins|environment_context|INSTRUCTIONS|skill|system-reminder|task-notification|local-command-caveat|local-command-stdout|local-command-stderr|command-name|command-message|user_instructions|turn_aborted|subagent_notification)\b[^>]*>[\s\S]*?<\/\1>/g;
const agentsPreamble = /^# AGENTS\.md instructions for .*$/gm;
const unwrappedTags = /<\/?command-args>/g;
const imagePlaceholder = /^\[Image[^\]]*\]\s*$/gm;
const skillInvocation = /^\$[\w-]+\s+/;
const constraintMarker = /\b(don'?t|do not|never|instead|rather than|shouldn'?t|should not|should|must|always|avoid|prefer|use (?:the|a|an)?\s?\w+|put (?:it|this|that|them)|move (?:it|this|that|them)|belongs?|wrong|why did you|not (?:in|into|from|via|through) the|stop|only (?:via|through|in))\b/i;
const minimumLength = 12;
const maximumLength = 4000;

function cleanTurnText(text: string): string {
  return text.replace(injectedBlock, "").replace(agentsPreamble, "").replace(unwrappedTags, "").replace(imagePlaceholder, "").replace(skillInvocation, "").trim();
}

export function correctionCandidates(turns: readonly UserTurn[], scopeTerms: readonly string[], author: string, drops: DropLedger): HarvestItem[] {
  const cleaned = turns.map((turn) => ({ ...turn, text: cleanTurnText(turn.text) }));
  const substantive = cleaned.filter(({ text }) => text.length >= minimumLength);
  drops.record("session", "empty after removing injected context (skills, reminders, notifications)", cleaned.length - substantive.length);
  const unique = distinctTurns(substantive);
  drops.record("session", "repeat of an earlier turn, in the same session or another store", substantive.length - unique.length);
  const bounded = unique.filter(({ text }) => text.length <= maximumLength);
  drops.record("session", `longer than ${maximumLength} characters (pasted plan or document)`, unique.length - bounded.length);
  const constraining = bounded.filter(({ text }) => constraintMarker.test(text));
  drops.record("session", "no correcting or constraining language", bounded.length - constraining.length);
  const scoped = constraining.filter((turn) => mentionsAny(`${turn.context}\n${turn.text}`, scopeTerms));
  drops.record("session", "neither the turn nor its thread mentions the scope", constraining.length - scoped.length);
  return scoped.map((turn) => itemOf(turn, author));
}

function distinctTurns(turns: readonly UserTurn[]): UserTurn[] {
  const seen = new Set<string>();
  return turns.filter(({ text }) => {
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mentionsAny(text: string, terms: readonly string[]): boolean {
  const lowered = text.toLowerCase();
  return terms.some((term) => lowered.includes(term.toLowerCase()));
}

function itemOf(turn: UserTurn, author: string): HarvestItem {
  const origin = `session:${turn.source}/${turn.sessionId}`;
  return { id: `${origin}#${turn.turnId}`, source: "session", origin, url: `local:${turn.source}/${turn.sessionId}#${turn.turnId}`, author, isBot: false, byPullRequestAuthor: false, path: null, line: null, body: turn.text, at: turn.at || null };
}
