import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type GraphqlVariables, graphqlText } from "../../harvest/lib/gh.ts";

export type Graphql = (query: string, variables: GraphqlVariables) => Promise<unknown>;
type Send = (query: string, variables: GraphqlVariables) => Promise<string>;
type Pause = (milliseconds: number) => Promise<void>;
export type Transport = { send: Send; pause: Pause; now: () => number; log: (line: string) => void };

const rateLimitSchema = z.object({ data: z.object({ rateLimit: z.object({ remaining: z.number(), resetAt: z.string() }).optional() }).optional() });

const reserve = 400;
const attempts = 4;
const retryPause = 15_000;

const liveTransport: Transport = { send: graphqlText, pause: (milliseconds) => Bun.sleep(milliseconds), now: Date.now, log: console.error };

export function graphqlCacheDirectory(work: string): string {
  return join(work, "graphql");
}

export function cachedGraphql(work: string, transport: Transport = liveTransport): Graphql {
  return async (query, variables) => {
    const file = join(graphqlCacheDirectory(work), `${cacheKey(query, variables)}.json`);
    const cached = await readFile(file, "utf8").catch(() => null);
    if (cached !== null) return JSON.parse(cached);
    const text = await withRetries(() => transport.send(query, variables), transport);
    await store(file, text);
    await respectRateLimit(text, transport);
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

async function withRetries(request: () => Promise<string>, transport: Transport): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const text = await request();
      JSON.parse(text);
      return text;
    } catch (error) {
      if (attempt >= attempts) throw error;
      const pause = /rate limit/i.test(String(error)) ? retryPause * 6 : retryPause * attempt;
      transport.log(`graphql attempt ${attempt} failed (${String(error).slice(0, 200)}); retrying in ${pause / 1000}s`);
      await transport.pause(pause);
    }
  }
}

async function respectRateLimit(text: string, transport: Transport): Promise<void> {
  const rateLimit = rateLimitSchema.parse(JSON.parse(text)).data?.rateLimit;
  if (!rateLimit || rateLimit.remaining > reserve) return;
  const wait = Math.max(0, Date.parse(rateLimit.resetAt) - transport.now()) + 5_000;
  transport.log(`graphql budget at ${rateLimit.remaining}; waiting ${Math.round(wait / 1000)}s for the reset at ${rateLimit.resetAt}`);
  await transport.pause(wait);
}
