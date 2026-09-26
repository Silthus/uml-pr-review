import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runTests } from "../../coherence/loop/test-runs.ts";

const testFile = "products/a/backend/test/test_runner.py";
const conftestCrash =
  "Traceback (most recent call last):\n  File \"posthog/conftest.py\", line 3, in <module>\ngoogle.protobuf.runtime_version.VersionError: Detected incompatible Protobuf Gencode/Runtime versions when loading personhog/types/v1/common.proto: gencode 6.31.1 runtime 5.29.6.";

let workspace: string;
let mainCheckout: string;

async function executable(path: string, script: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, script);
  await chmod(path, 0o755);
}

const borrowedPytest = (output: string, code: number) =>
  executable(join(mainCheckout, ".flox", "cache", "venv", "bin", "pytest"), `#!/bin/sh\ncat <<'OUTPUT'\n${output}\nOUTPUT\nexit ${code}\n`);

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "coherence-workspace-"));
  mainCheckout = await mkdtemp(join(tmpdir(), "coherence-main-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(mainCheckout, { recursive: true, force: true });
});

describe("pytest outcomes", () => {
  test("a crash while loading conftest ran no test, so it is not run with the crash as the reason", async () => {
    await borrowedPytest(conftestCrash, 1);

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ runner: "pytest", status: "not run", reason: expect.stringContaining("VersionError: Detected incompatible Protobuf") });
  });

  test("a collection error interrupts pytest before any test runs", async () => {
    await borrowedPytest("ERROR collecting products/a/backend/test/test_runner.py\n!!! Interrupted: 1 error during collection !!!\n1 error in 0.21s", 2);

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ status: "not run", reason: "pytest ran no test (exit 2): 1 error in 0.21s" });
  });

  test("tests that only error in setup ran no assertion, so they are not run", async () => {
    await borrowedPytest("EEE\nE   FileNotFoundError: [Errno 2] No such file or directory: 'sqlx'\n3 errors in 16.94s", 1);

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ status: "not run", reason: "pytest ran no test (exit 1): 3 errors in 16.94s" });
  });

  test("a summary that counts failed tests is a failure", async () => {
    await borrowedPytest("F.\nFAILED products/a/backend/test/test_runner.py::test_dispatch - assert 3 == 4\n1 failed, 1 passed in 0.12s", 1);

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ status: "failed", reason: null });
  });
});

describe("the Python test environment", () => {
  test("a workspace with a uv lock runs pytest through uv, frozen, in a venv of its own", async () => {
    await borrowedPytest(conftestCrash, 1);
    await writeFile(join(workspace, "uv.lock"), "version = 1\n");
    await executable(join(mainCheckout, ".flox", "run", "aarch64-darwin.dev", "bin", "uv"), '#!/bin/sh\necho "uv $* into $UV_PROJECT_ENVIRONMENT with global git config $GIT_CONFIG_GLOBAL"\necho "2 passed in 0.30s"\n');

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ status: "passed" });
    expect(run!.output).toContain(`uv run --quiet --frozen pytest -q -p no:cacheprovider ${testFile} into ${join(workspace, ".venv")} with global git config /dev/null`);
  });
});
