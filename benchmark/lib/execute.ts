export type Execution = { code: number; stdout: string; stderr: string };

export async function execute(cwd: string, command: string[], stdin?: string): Promise<Execution> {
  const child = Bun.spawn(command, { cwd, stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, stdout, stderr };
}
