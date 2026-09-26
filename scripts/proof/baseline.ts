import { z } from "zod";

const commands = {
  status: ["status", "--porcelain"],
  head: ["rev-parse", "HEAD"],
  worktrees: ["worktree", "list"],
} as const;

type Key = keyof typeof commands;

const DigestSchema = z.object({ sha256: z.string(), lines: z.number().int() });
const BaselineSchema = z.object({ status: DigestSchema, head: DigestSchema, worktrees: DigestSchema });
type Baseline = z.infer<typeof BaselineSchema>;

const [repository, beforePath] = process.argv.slice(2);
if (!repository) throw new Error("Usage: bun scripts/proof/baseline.ts <repository> [<baseline JSON to compare with>]");

const now = await record(repository);
if (!beforePath) {
  console.log(JSON.stringify(now, null, 2));
} else {
  const before = BaselineSchema.parse(await Bun.file(beforePath).json());
  const different = compare(before, now);
  process.exit(different.length === 0 ? 0 : 1);
}

async function record(path: string): Promise<Baseline> {
  const entries = await Promise.all((Object.keys(commands) as Key[]).map(async (key) => [key, digest(await git(path, commands[key]))] as const));
  return BaselineSchema.parse(Object.fromEntries(entries));
}

async function git(path: string, args: readonly string[]): Promise<string> {
  const process = Bun.spawn(["git", "-C", path, ...args], { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(process.stdout).text();
  if ((await process.exited) !== 0) throw new Error(`git ${args.join(" ")} failed in ${path}`);
  return output;
}

function digest(output: string): z.infer<typeof DigestSchema> {
  return { sha256: new Bun.CryptoHasher("sha256").update(output).digest("hex"), lines: output === "" ? 0 : output.split("\n").length - 1 };
}

function compare(before: Baseline, after: Baseline): Key[] {
  const keys = Object.keys(commands) as Key[];
  for (const key of keys) console.log(`git ${commands[key].join(" ")}: ${sameDigest(before[key], after[key]) ? "identical" : "DIFFERENT"} (${after[key].lines} lines, sha256 ${after[key].sha256})`);
  return keys.filter((key) => !sameDigest(before[key], after[key]));
}

function sameDigest(left: z.infer<typeof DigestSchema>, right: z.infer<typeof DigestSchema>): boolean {
  return left.sha256 === right.sha256 && left.lines === right.lines;
}
