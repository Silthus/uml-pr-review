#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const rubric = readFileSync(join(import.meta.dir, "judgements", "rubric.md"), "utf8");

export const astraDelivery = "The PRs to judge are attached below in the <stdin> block. Do not read, search, or run anything else.";

export function opusDelivery(packet: string, output: string): string {
  return [
    `The PRs to judge are in ${packet}. Read all of it with the Read tool, in chunks if it is long.`,
    "Do not read any other file, do not search, do not run commands, and do not use the web.",
    `When you are done, write your JSON array to ${output} with the Write tool, and reply with the same JSON array.`,
  ].join(" ");
}

export function judgePrompt(delivery: string): string {
  return ["You are an independent code-quality judge. Work alone and use only the material given here.", delivery, "Follow this rubric exactly and answer with only the JSON array it asks for.", "", rubric].join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { batch: { type: "string" }, packets: { type: "string", default: "/tmp/coherence-validation-packets" } } });
  const output = join(import.meta.dir, "judgements", "opus", `batch-${values.batch}.json`);
  console.log(judgePrompt(opusDelivery(join(values.packets!, `batch-${values.batch}.md`), output)));
}
