import { describe, expect, test } from "bun:test";
import { parsePatch } from "../lib/patch.ts";

const patch = [
  "diff --git a/old name.py b/new name.py",
  "similarity index 90%",
  "rename from old name.py",
  "rename to new name.py",
  "--- a/old name.py",
  "+++ b/new name.py",
  "@@ -1,2 +1,2 @@",
  " import os",
  "-x = 1",
  "+x = 2",
  "diff --git a/gone.py b/gone.py",
  "deleted file mode 100644",
  "--- a/gone.py",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-print()",
  "diff --git a/logo.png b/logo.png",
  "new file mode 100644",
  "Binary files /dev/null and b/logo.png differ",
  "diff --git a/added.py b/added.py",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/added.py",
  "@@ -0,0 +1,2 @@",
  "+--- not a header",
  "++++ still content",
  "",
].join("\n");

describe("parsing a git diff", () => {
  test("reads renames, deletions, binary files, and hunk lines that look like headers", () => {
    const files = parsePatch(patch).map(({ path, previousPath, status, added, removed, hunks }) => ({ path, previousPath, status, added, removed, hunks }));

    expect(files).toEqual([
      { path: "new name.py", previousPath: "old name.py", status: "renamed", added: 1, removed: 1, hunks: [{ start: 1, length: 2 }] },
      { path: "gone.py", previousPath: "gone.py", status: "deleted", added: 0, removed: 1, hunks: [{ start: 0, length: 0 }] },
      { path: "logo.png", previousPath: "logo.png", status: "added", added: 0, removed: 0, hunks: [] },
      { path: "added.py", previousPath: "added.py", status: "added", added: 2, removed: 0, hunks: [{ start: 1, length: 2 }] },
    ]);
  });
});
