import { parseArgs } from "node:util";
import { defaultEnvironment, setUp, type Language } from "./kit.ts";

const USAGE = "usage: bun benchmark/replay/kit/setup.ts <dir> --ref <posthog-ref> --language typescript|python [--hooks]";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { ref: { type: "string" }, language: { type: "string" }, hooks: { type: "boolean", default: false } },
});

function isLanguage(value: string | undefined): value is Language {
  return value === "typescript" || value === "python";
}

const [dir] = positionals;
if (dir === undefined || values.ref === undefined || !isLanguage(values.language)) {
  console.error(USAGE);
  process.exit(64);
}

await setUp({ dir, ref: values.ref, language: values.language, hooks: values.hooks }, defaultEnvironment(), console.log);
