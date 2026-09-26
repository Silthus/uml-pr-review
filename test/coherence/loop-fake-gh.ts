import { appendFile, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type GhCall = { args: string[]; stdin: string };
export type FakeIssue = { number: number; url: string; title: string; state: "OPEN" | "CLOSED"; stateReason: string | null; labels: string[]; body: string; comments: { body: string; authorAssociation: string }[] };
export type FakeGhState = { issues: FakeIssue[]; pullRequests: unknown[]; labels: string[] };
export type FakeGh = { env: Record<string, string>; calls(): Promise<GhCall[]>; state(): Promise<FakeGhState>; cleanup(): Promise<void> };

export async function fakeGh(initial: Partial<FakeGhState> = {}): Promise<FakeGh> {
  const directory = await mkdtemp(join(tmpdir(), "coherence-fake-gh-"));
  const log = join(directory, "calls.jsonl");
  const statePath = join(directory, "state.json");
  await writeFile(statePath, JSON.stringify({ issues: [], pullRequests: [], labels: [], ...initial }));
  await writeFile(log, "");
  await writeFile(join(directory, "gh"), `#!/bin/sh\nexec bun ${JSON.stringify(import.meta.path)} "$@"\n`);
  await chmod(join(directory, "gh"), 0o755);
  return {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FAKE_GH_LOG: log, FAKE_GH_STATE: statePath } as Record<string, string>,
    calls: async () => (await Bun.file(log).text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as GhCall),
    state: async () => (await Bun.file(statePath).json()) as FakeGhState,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function respond(args: string[], stdin: string, state: FakeGhState): Promise<string> {
  const [noun, verb, target] = args;
  const repository = option(args, "--repo") ?? "unknown/unknown";
  const issue = () => state.issues.find(({ number }) => number === Number(target))!;
  switch (`${noun} ${verb}`) {
    case "pr list":
      return JSON.stringify(state.pullRequests);
    case "pr create":
      return `https://github.com/${repository}/pull/4242\n`;
    case "issue list":
      return JSON.stringify(state.issues);
    case "label create":
      state.labels = [...new Set([...state.labels, target!])];
      return "";
    case "issue create": {
      const number = 100 + state.issues.length;
      const url = `https://github.com/${repository}/issues/${number}`;
      state.issues.push({ number, url, title: option(args, "--title")!, state: "OPEN", stateReason: null, labels: [option(args, "--label")!], body: stdin, comments: [] });
      return `${url}\n`;
    }
    case "issue view":
      return JSON.stringify({ labels: issue().labels.map((name) => ({ name })) });
    case "issue comment":
      issue().comments.push({ body: stdin, authorAssociation: "OWNER" });
      return "";
    case "issue close":
      issue().state = "CLOSED";
      issue().stateReason = option(args, "--reason") === "not planned" ? "NOT_PLANNED" : "COMPLETED";
      return "";
    default:
      throw new Error(`the fake gh has no answer for: gh ${args.join(" ")}`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const stdin = args.includes("-") ? await Bun.stdin.text() : "";
  await appendFile(process.env.FAKE_GH_LOG!, `${JSON.stringify({ args, stdin })}\n`);
  const state = (await Bun.file(process.env.FAKE_GH_STATE!).json()) as FakeGhState;
  process.stdout.write(await respond(args, stdin, state));
  await writeFile(process.env.FAKE_GH_STATE!, JSON.stringify(state));
}
