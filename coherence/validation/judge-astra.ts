#!/usr/bin/env bun
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { astraDelivery, judgePrompt } from "./judge-prompt.ts";

const judgements = join(import.meta.dir, "judgements");

async function judgeBatch(packets: string, batch: string): Promise<void> {
  const output = join(judgements, "astra", `batch-${batch}.json`);
  if (await Bun.file(output).exists()) return;
  const packet = await readFile(join(packets, `batch-${batch}.md`), "utf8");
  const child = Bun.spawn(["codex", "exec", "-m", "gpt-6-astra", "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-C", await mkdtemp(join(tmpdir(), "astra-judge-")), "-o", output, judgePrompt(astraDelivery)], {
    stdin: new TextEncoder().encode(packet),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`codex exec for batch ${batch} failed (${code}): ${stderr.trim().slice(-500)}`);
  console.error(`astra batch ${batch} judged`);
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { packets: { type: "string", default: "/tmp/coherence-validation-packets" }, concurrency: { type: "string", default: "4" } } });
  const packets = resolve(values.packets!);
  const plan = z.array(z.object({ batch: z.string() })).parse(JSON.parse(await readFile(join(judgements, "batches.json"), "utf8")));
  await mkdir(join(judgements, "astra"), { recursive: true });
  const pending = plan.map(({ batch }) => batch);
  const worker = async () => {
    for (let batch = pending.shift(); batch !== undefined; batch = pending.shift()) await judgeBatch(packets, batch);
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
}
