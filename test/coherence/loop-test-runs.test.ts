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

const pytestScript = (output: string, code: number) => `#!/bin/sh\necho "$0"\ncat <<'OUTPUT'\n${output}\nOUTPUT\nexit ${code}\n`;
const borrowedPytest = (output: string, code: number) => executable(join(mainCheckout, ".flox", "cache", "venv", "bin", "pytest"), pytestScript(output, code));
const floxUv = (script: string) => executable(join(mainCheckout, ".flox", "run", "aarch64-darwin.dev", "bin", "uv"), `#!/bin/sh\n${script}\n`);
const locks = async (workspaceLock: string, mainCheckoutLock: string) => {
  await writeFile(join(workspace, "uv.lock"), workspaceLock);
  await writeFile(join(mainCheckout, "uv.lock"), mainCheckoutLock);
};

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

  test("a colored summary that counts failed tests is a failure", async () => {
    await borrowedPytest("\x1b[31m\x1b[1m1 failed\x1b[0m, \x1b[32m1 passed\x1b[0m\x1b[31m in 0.12s\x1b[0m", 1);

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ status: "failed" });
  });
});

describe("the Python test environment", () => {
  test("a workspace whose uv lock differs from the main checkout's syncs a venv of its own, frozen", async () => {
    await borrowedPytest(conftestCrash, 1);
    await locks("version = 2\n", "version = 1\n");
    await floxUv(`[ "$*" = "sync --quiet --frozen" ] || exit 9\nmkdir -p "$UV_PROJECT_ENVIRONMENT/bin"\nprintf '%s' '${pytestScript("2 passed in 0.30s", 0)}' > "$UV_PROJECT_ENVIRONMENT/bin/pytest"\nchmod +x "$UV_PROJECT_ENVIRONMENT/bin/pytest"`);

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ status: "passed" });
    expect(run!.output).toStartWith(join(workspace, ".venv", "bin", "pytest"));
  });

  test("a workspace whose uv lock matches the main checkout's borrows its venv without syncing", async () => {
    await borrowedPytest("1 passed in 0.10s", 0);
    await locks("version = 1\n", "version = 1\n");
    await floxUv("exit 9");

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ status: "passed" });
    expect(run!.output).toStartWith(join(mainCheckout, ".flox", "cache", "venv", "bin", "pytest"));
  });

  test("a uv sync that fails is not run, with uv's error as the reason", async () => {
    await borrowedPytest(conftestCrash, 1);
    await locks("version = 2\n", "version = 1\n");
    await floxUv("echo '  × Failed to download and build `pytest-split`' >&2\necho 'hint: `pytest-split` was included because `posthog:dev` depends on it' >&2\nexit 1");

    const [run] = await runTests(workspace, mainCheckout, [testFile]);

    expect(run).toMatchObject({ status: "not run", reason: `uv could not sync ${join(workspace, "uv.lock")}: × Failed to download and build \`pytest-split\`` });
  });
});
