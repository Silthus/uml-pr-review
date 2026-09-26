#!/usr/bin/env bun
import { createEventBus } from "./architecture/events/index.ts";
import { createArchitectureRoutes, rejectForeignRequest } from "./architecture/http/index.ts";
import { createMcpRoute } from "./architecture/mcp/index.ts";
import { createArchitectureService } from "./architecture/service.ts";
import explorer from "./explorer/index.html";
import { CommandError, repositoryRoot, run } from "./git.ts";
import { githubRepository, listOpenPullRequests, type PullRequestScope } from "./github.ts";
import { buildGraph, currentPullRequest, renderGraph } from "./review.ts";
import pulls from "./web/index.html";

const port = Number(process.env.PORT ?? 4477);
const bus = createEventBus();
const architecture = createArchitectureService({ bus, explorerOrigin: `http://127.0.0.1:${port}` });
const artifacts = new Map<string, Promise<string>>();

class BadRequest extends Error {}

async function openRepository(path: string | null) {
  if (!path) throw new BadRequest("Pick a folder first.");
  const root = await repositoryRoot(path).catch(() => {
    throw new BadRequest(`${path} is not inside a Git repository.`);
  });
  const repo = await githubRepository(root).catch(() => {
    throw new BadRequest(`${root} has no GitHub remote that the gh CLI can read.`);
  });
  return { root, repo };
}

async function chooseFolder(): Promise<{ path: string | null }> {
  if (process.platform !== "darwin") throw new BadRequest("The folder dialog only works on macOS. Paste the path instead.");
  const script = 'POSIX path of (choose folder with prompt "Pick a Git repository")';
  const path = await run(process.cwd(), ["osascript", "-e", script]).catch(() => null);
  return { path: path?.trim().replace(/\/$/, "") || null };
}

function artifactFor(root: string, number: number): Promise<string> {
  return currentPullRequest(root, number).then((pull) => {
    const key = `${root}\0${pull.number}\0${pull.headSha}`;
    if (!artifacts.has(key)) {
      const artifact = buildGraph(root, pull).then(renderGraph);
      artifact.catch(() => artifacts.delete(key));
      artifacts.set(key, artifact);
    }
    return artifacts.get(key)!;
  });
}

function failure(error: unknown): Response {
  const status = error instanceof BadRequest ? 400 : 500;
  const message = error instanceof CommandError ? error.stderr.trim() || error.message : String((error as Error)?.message ?? error);
  if (status === 500) console.error(error);
  return Response.json({ error: message }, { status });
}

const handle = (handler: (url: URL, request: Request) => Promise<Response>) => async (request: Request) =>
  rejectForeignRequest(request) ?? handler(new URL(request.url), request).catch(failure);

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": explorer,
    "/pulls": pulls,
    "/mcp": createMcpRoute({ service: architecture, bus }),
    ...createArchitectureRoutes({ service: architecture, bus }),
    "/api/repository": handle(async (url) => Response.json(await openRepository(url.searchParams.get("path")))),
    "/api/choose-folder": { POST: handle(async () => Response.json(await chooseFolder())) },
    "/api/pulls": handle(async (url) => {
      const { root } = await openRepository(url.searchParams.get("path"));
      const scope: PullRequestScope = url.searchParams.get("scope") === "all" ? "all" : "mine";
      return Response.json(await listOpenPullRequests(root, scope));
    }),
    "/review/:number": handle(async (url, request) => {
      const number = Number((request as Request & { params: { number: string } }).params.number);
      if (!Number.isInteger(number) || number <= 0) throw new BadRequest("Pull request numbers are positive integers.");
      const { root } = await openRepository(url.searchParams.get("path"));
      return new Response(await artifactFor(root, number), { headers: { "content-type": "text/html; charset=utf-8" } });
    }),
  },
});

console.log(`uml-pr-review is running at ${server.url}`);
