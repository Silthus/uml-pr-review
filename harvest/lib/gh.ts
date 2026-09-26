import type { z } from "zod";

export async function gh<T>(args: readonly string[], schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await ghText(args)));
}

export async function ghLines<T>(args: readonly string[], schema: z.ZodType<T>): Promise<T[]> {
  const lines = (await ghText(args)).split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line) => schema.parse(JSON.parse(line)));
}

async function ghText(args: readonly string[]): Promise<string> {
  const process = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

export async function graphql<T>(query: string, variables: Record<string, string | number>, schema: z.ZodType<T>): Promise<T> {
  const fields = Object.entries(variables).flatMap(([name, value]) => [typeof value === "number" ? "-F" : "-f", `${name}=${value}`]);
  return gh(["api", "graphql", "-f", `query=${query}`, ...fields], schema);
}

export async function rawContent(repo: string, path: string): Promise<string | null> {
  const process = Bun.spawn(["gh", "api", `repos/${repo}/contents/${path}`, "-H", "Accept: application/vnd.github.raw"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(process.stdout).text(), process.exited]);
  return exitCode === 0 ? stdout : null;
}
