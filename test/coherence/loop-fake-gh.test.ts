import { describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { fakeGh } from "./loop-fake-gh.ts";

const inbox = join(import.meta.dir, "../../coherence/inbox.ts");

describe("a run against the fake gh", () => {
  test("cannot reach GitHub even when the fake stops being executable and the real gh runs instead", async () => {
    const gh = await fakeGh();
    try {
      await chmod(gh.executable, 0o644);

      const child = Bun.spawn(["bun", inbox, "list"], { stdout: "pipe", stderr: "pipe", env: gh.env });
      const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);

      expect(code).toBe(1);
      expect((JSON.parse(stdout) as { error: string }).error).toContain("error connecting to fake-gh.invalid");
      expect(await gh.calls()).toEqual([]);
    } finally {
      await gh.cleanup();
    }
  });
});
