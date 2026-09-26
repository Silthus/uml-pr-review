import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./loop-fake-gh.ts";

const inbox = join(import.meta.dir, "../../coherence/inbox.ts");

let gh: FakeGh;

async function failedOutput(command: string[]): Promise<{ code: number; output: string }> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env: gh.env });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, output: `${stdout}${stderr}` };
}

beforeEach(async () => {
  gh = await fakeGh();
  await chmod(gh.executable, 0o644);
});

afterEach(() => gh.cleanup());

describe("when the fake gh stops being executable and the real gh runs in its place", () => {
  test("an owner/name command cannot reach GitHub", async () => {
    const { code, output } = await failedOutput(["bun", inbox, "list"]);

    expect(code).toBe(1);
    expect(output).toContain("error connecting to fake-gh.invalid");
    expect(await gh.calls()).toEqual([]);
  });

  test("a pull request URL command cannot authenticate to GitHub", async () => {
    const { code, output } = await failedOutput(["gh", "pr", "view", "https://github.com/Silthus/uml-pr-review/pull/84", "--json", "state,mergeCommit"]);

    expect(code).toBe(1);
    expect(output).toContain("Bad credentials");
    expect(await gh.calls()).toEqual([]);
  });
});
