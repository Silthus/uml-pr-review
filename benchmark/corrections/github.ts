import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type GraphqlVariables, graphqlText } from "../../harvest/lib/gh.ts";

export type Graphql = (query: string, variables: GraphqlVariables) => Promise<unknown>;
type Send = (query: string, variables: GraphqlVariables) => Promise<string>;

const rateLimitSchema = z.object({ data: z.object({ rateLimit: z.object({ cost: z.number(), remaining: z.number(), resetAt: z.string() }).optional() }).optional() });

const reserve = 400;
const attempts = 4;
const retryPause = 15_000;

export const budgetFile = "budget.jsonl";

export function cachedGraphql(directory: string, send: Send = graphqlText, log: (line: string) => void = console.error): Graphql {
  return async (query, variables) => {
    const file = join(directory, "graphql", `${cacheKey(query, variables)}.json`);
    const cached = await readFile(file, "utf8").catch(() => null);
    if (cached !== null) return JSON.parse(cached);
    const text = await withRetries(() => send(query, variables), log);
    await store(file, text);
    await respectRateLimit(directory, text, log);
    return JSON.parse(text);
  };
}

function cacheKey(query: string, variables: GraphqlVariables): string {
  return createHash("sha256").update(JSON.stringify([query, variables])).digest("hex").slice(0, 32);
}

async function store(file: string, text: string): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(`${file}.partial`, text);
  await rename(`${file}.partial`, file);
}

async function withRetries(request: () => Promise<string>, log: (line: string) => void): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const text = await request();
      JSON.parse(text);
      return text;
    } catch (error) {
      if (attempt >= attempts) throw error;
      const pause = /rate limit/i.test(String(error)) ? retryPause * 6 : retryPause * attempt;
      log(`graphql attempt ${attempt} failed (${String(error).slice(0, 200)}); retrying in ${pause / 1000}s`);
      await Bun.sleep(pause);
    }
  }
}

async function respectRateLimit(directory: string, text: string, log: (line: string) => void): Promise<void> {
  const rateLimit = rateLimitSchema.parse(JSON.parse(text)).data?.rateLimit;
  if (!rateLimit) return;
  await appendFile(join(directory, budgetFile), `${JSON.stringify({ ...rateLimit, at: new Date().toISOString() })}\n`);
  if (rateLimit.remaining > reserve) return;
  const wait = Math.max(0, Date.parse(rateLimit.resetAt) - Date.now()) + 5_000;
  log(`graphql budget at ${rateLimit.remaining}; waiting ${Math.round(wait / 1000)}s for the reset at ${rateLimit.resetAt}`);
  await Bun.sleep(wait);
}
