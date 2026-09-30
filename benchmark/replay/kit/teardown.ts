import { tearDown } from "./kit.ts";

const [dir] = process.argv.slice(2);
if (dir === undefined) {
  console.error("usage: bun benchmark/replay/kit/teardown.ts <dir>");
  process.exit(64);
}

await tearDown(dir, console.log);
