import { afterAll, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const nativeWorker = globalThis.Worker;

export function useHappyDom() {
  beforeAll(register);
  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  });
}

function register() {
  if (GlobalRegistrator.isRegistered) return;
  GlobalRegistrator.register({ url: "http://localhost/" });
  globalThis.Worker = nativeWorker;
}

register();
