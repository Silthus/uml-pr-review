import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArchitecturePlanSchema, type ArchitecturePlan } from "../contracts/index.ts";

export type PlanFiles = {
  ids(): Promise<string[]>;
  exists(id: string): Promise<boolean>;
  read(id: string): Promise<ArchitecturePlan | undefined>;
  write(plan: ArchitecturePlan): Promise<ArchitecturePlan>;
};

const planFileName = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

export function planFiles(directory: string): PlanFiles {
  const pathOf = (id: string) => join(directory, `${id}.json`);

  async function ids(): Promise<string[]> {
    const names = await readdir(directory).catch(orWhenMissing<string[]>([]));
    return names.flatMap((name) => planFileName.exec(name)?.slice(1, 2) ?? []).sort();
  }

  async function read(id: string): Promise<ArchitecturePlan | undefined> {
    if (!ArchitecturePlanSchema.shape.id.safeParse(id).success) return undefined;
    const text = await readFile(pathOf(id), "utf8").catch(orWhenMissing(undefined));
    return text === undefined ? undefined : ArchitecturePlanSchema.parse(JSON.parse(text));
  }

  async function write(plan: ArchitecturePlan): Promise<ArchitecturePlan> {
    const canonical = canonicalPlan(plan);
    const temporary = `${pathOf(plan.id)}.${crypto.randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(canonical, null, 2)}\n`);
      await rename(temporary, pathOf(plan.id));
    } finally {
      await rm(temporary, { force: true });
    }
    return canonical;
  }

  return { ids, exists: (id) => Bun.file(pathOf(id)).exists(), read, write };
}

function canonicalPlan(plan: ArchitecturePlan): ArchitecturePlan {
  return ArchitecturePlanSchema.parse({
    ...plan,
    modules: plan.modules.toSorted((a, b) => compare(a.path, b.path)),
    seams: plan.seams.toSorted((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
    comments: plan.comments.toSorted((a, b) => commentNumber(a.id) - commentNumber(b.id)),
    revisions: plan.revisions.toSorted((a, b) => a.number - b.number),
  });
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

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
