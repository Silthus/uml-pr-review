import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ArchitecturePlanSchema, type ArchitecturePlan } from "../contracts/index.ts";
import * as feedback from "./feedback.ts";
import { compare } from "./paths.ts";

export type PlanFile = { status: "found"; plan: ArchitecturePlan } | { status: "missing" } | { status: "unreadable"; message: string };

export type PlanFiles = {
  ids(): Promise<string[]>;
  exists(id: string): Promise<boolean>;
  load(id: string): Promise<PlanFile>;
  write(plan: ArchitecturePlan): Promise<ArchitecturePlan>;
};

const planFileName = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

export function planFiles(directory: string): PlanFiles {
  const pathOf = (id: string) => join(directory, `${id}.json`);

  async function ids(): Promise<string[]> {
    const names = await readdir(directory).catch(orWhenMissing<string[]>([]));
    return names.flatMap((name) => planFileName.exec(name)?.slice(1, 2) ?? []).sort();
  }

  async function exists(id: string): Promise<boolean> {
    return access(pathOf(id)).then(() => true, orWhenMissing(false));
  }

  async function load(id: string): Promise<PlanFile> {
    if (!ArchitecturePlanSchema.shape.id.safeParse(id).success) return { status: "missing" };
    const text = await readFile(pathOf(id), "utf8").catch(orWhenMissing(undefined));
    return text === undefined ? { status: "missing" } : parsePlanFile(pathOf(id), text);
  }

  async function write(plan: ArchitecturePlan): Promise<ArchitecturePlan> {
    const text = serialize(plan);
    const temporary = `${pathOf(plan.id)}.${crypto.randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporary, text);
      await rename(temporary, pathOf(plan.id));
    } finally {
      await rm(temporary, { force: true });
    }
    return ArchitecturePlanSchema.parse(JSON.parse(text));
  }

  return { ids, exists, load, write };
}

function parsePlanFile(path: string, text: string): PlanFile {
  const json = parseJson(text);
  if (!json.success) return { status: "unreadable", message: feedback.unreadablePlan(path, json.reason) };
  const parsed = ArchitecturePlanSchema.safeParse(json.value);
  if (!parsed.success) return { status: "unreadable", message: feedback.unreadablePlan(path, z.prettifyError(parsed.error).replaceAll("\n", " ")) };
  return { status: "found", plan: parsed.data };
}

function parseJson(text: string): { success: true; value: unknown } | { success: false; reason: string } {
  try {
    return { success: true, value: JSON.parse(text) };
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function serialize(plan: ArchitecturePlan): string {
  const canonical = ArchitecturePlanSchema.parse({
    ...plan,
    modules: plan.modules.toSorted((a, b) => compare(a.path, b.path)),
    seams: plan.seams.toSorted((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
    comments: plan.comments.toSorted((a, b) => commentNumber(a.id) - commentNumber(b.id)),
    revisions: plan.revisions.toSorted((a, b) => a.number - b.number),
  });
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

function commentNumber(id: string): number {
  return Number(id.slice(1));
}

function orWhenMissing<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return fallback;
    throw error;
  };
}
