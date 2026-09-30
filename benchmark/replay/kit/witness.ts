import { witness } from "./kit.ts";

const [dir, target] = process.argv.slice(2);
if (dir === undefined || target === undefined) {
  console.error("usage: bun benchmark/replay/kit/witness.ts <dir> <component>/<invariant>");
  process.exit(64);
}

process.exit((await witness(dir, target, console.log)) ? 0 : 1);
