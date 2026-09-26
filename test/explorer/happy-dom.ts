import { afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const nativeWorker = globalThis.Worker;

GlobalRegistrator.register({ url: "http://localhost/" });
globalThis.Worker = nativeWorker;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});
