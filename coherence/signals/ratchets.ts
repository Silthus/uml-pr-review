import { listBlobs, readBlobs } from "../../src/architecture/index/git.ts";

export type ConfigMention = { path: string; source: string };

const rootLintConfig = /^(?:tach\.toml|pyproject\.toml|ruff\.toml|mypy\.ini|setup\.cfg|\.oxlintrc\.json|\.eslintrc(?:\.\w+)?|eslint\.config\.\w+)$/;
const baselineFile = /(?:^|\/)[^/]*baseline[^/]*\.(?:txt|json|ya?ml)$/i;

export async function readConfigMentions(root: string, tree: string, scope: string): Promise<ConfigMention[]> {
  const configs = (await listBlobs(root, tree)).filter(({ path }) => rootLintConfig.test(path) || baselineFile.test(path));
  const texts = await readBlobs(root, configs.map(({ sha }) => sha));
  const mention = scopeMention(scope);
  return configs.flatMap(({ path, sha }) =>
    (texts.get(sha) ?? "").split("\n").flatMap((line, index) => [...line.matchAll(mention)].map(([token]) => ({ path: asPath(token), source: `${path}:${index + 1}` }))),
  );
}

function scopeMention(scope: string): RegExp {
  const slashed = escape(scope);
  const dotted = escape(scope.replaceAll("/", "."));
  return new RegExp(`(?<![\\w./])(?:${slashed}(?:/[\\w.-]+)*|${dotted}(?:\\.\\w+)*)`, "g");
}

function asPath(token: string): string {
  return token.includes("/") ? token : token.replaceAll(".", "/");
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
