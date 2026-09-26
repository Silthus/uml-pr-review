import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../src/git.ts";
import type { Sense } from "../../coherence/loop/state.ts";
import { temporaryRepository, type TemporaryRepository } from "../architecture/index/repository.ts";
import { fakeGh, type FakeGh } from "./loop-fake-gh.ts";

const toolTimeoutMs = 60_000;
const sense = join(import.meta.dir, "../../coherence/loop/sense.ts");

let scratch: string;
let repository: TemporaryRepository;
let upstream: string;
let gh: FakeGh;
let gitShim: string;
let globalGitConfig: string;

type Sensed = { code: number; json: { sense?: string; base?: Sense["base"]; error?: string } };

async function senseWithFetch(remoteUrl: string): Promise<Sensed> {
  await repository.git("remote", "set-url", "upstream", remoteUrl);
  const runs = await mkdtemp(join(scratch, "runs-"));
  const child = Bun.spawn(
    ["bun", sense, "--repo", repository.dir, "--scope", "products/a", "--base", "upstream/main", "--fetch", "--github", "acme/app", "--rules", join(scratch, "rules.json"), "--runs", runs],
    { stdout: "pipe", stderr: "pipe", env: { ...gh.env, PATH: `${gitShim}:${gh.env.PATH}`, GIT_SSH_COMMAND: "false", GIT_CONFIG_GLOBAL: globalGitConfig, GIT_CONFIG_NOSYSTEM: "1" } },
  );
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, json: JSON.parse(stdout) };
}

async function advanceUpstream(): Promise<string> {
  const next = (await repository.git("commit-tree", "HEAD^{tree}", "-p", "refs/remotes/upstream/main", "-m", "upstream moved on")).trim();
  await repository.git("push", "--quiet", upstream, `+${next}:refs/heads/main`);
  return next;
}

async function gitCalls(): Promise<string[]> {
  return (await Bun.file(join(gitShim, "calls.log")).text()).split("\n").filter(Boolean);
}

async function loggingGit(): Promise<string> {
  const directory = join(scratch, "git-shim");
  await mkdir(directory);
  await writeFile(join(directory, "calls.log"), "");
  await writeFile(join(directory, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${join(directory, "calls.log")}\nexec ${Bun.which("git")} "$@"\n`);
  await chmod(join(directory, "git"), 0o755);
  return directory;
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "coherence-sense-"));
  gitShim = await loggingGit();
  globalGitConfig = join(scratch, "gitconfig");
  await writeFile(globalGitConfig, '[url "git@github.com:"]\n\tinsteadOf = https://github.com/\n[protocol "https"]\n\tallow = never\n');
  repository = await temporaryRepository({ "products/a/backend/api.py": "def run(value):\n    return value\n" });
  upstream = join(scratch, "upstream.git");
  await git(scratch, ["init", "--quiet", "--bare", upstream]);
  await repository.git("push", "--quiet", upstream, "HEAD:refs/heads/main");
  await repository.git("remote", "add", "upstream", "git@github.com:acme/app.git");
  await repository.git("fetch", "--quiet", upstream, "+main:refs/remotes/upstream/main");
  await repository.git("config", `url.${upstream}.insteadOf`, "https://github.com/acme/app.git");
  await writeFile(join(scratch, "rules.json"), JSON.stringify({ components: [], rules: [] }));
  gh = await fakeGh();
}, toolTimeoutMs);

afterAll(async () => {
  await repository.cleanup();
  await gh.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

describe("sense --fetch", () => {
  test.each(["git@github.com:acme/app.git", "ssh://git@github.com:22/acme/app", "https://GitHub.com/acme/app/"])(
    "moves the base to the head of GitHub remote %s over HTTPS, without an SSH agent, despite a global rewrite to SSH",
    async (remoteUrl) => {
      const next = await advanceUpstream();
      const earlierCalls = (await gitCalls()).length;

      const sensed = await senseWithFetch(remoteUrl);

      expect(sensed).toMatchObject({ code: 0, json: { base: { ref: "upstream/main", commit: next } } });
      expect((await repository.git("rev-parse", "upstream/main")).trim()).toBe(next);
      expect((await gitCalls()).slice(earlierCalls).filter((call) => call.includes(" fetch "))).toEqual([expect.stringContaining("credential.helper=!gh auth git-credential fetch --quiet https://github.com/acme/app.git +refs/heads/main:refs/remotes/upstream/main")]);
    },
    toolTimeoutMs,
  );

  test(
    "names the remote and the base when a remote outside GitHub cannot be reached over SSH",
    async () => {
      const sensed = await senseWithFetch("git@git.example.com:acme/app.git");

      expect(sensed.code).toBe(1);
      expect(sensed.json.error).toStartWith("could not fetch upstream/main from git@git.example.com:acme/app.git: ");
    },
    toolTimeoutMs,
  );
});
