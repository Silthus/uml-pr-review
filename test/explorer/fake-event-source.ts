import type { ArchitectureEvent } from "../../src/architecture/contracts/index.ts";

export class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  static install() {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  }

  static get latest(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1);
    if (!source) throw new Error("No event stream was opened");
    return source;
  }

  close() {}

  open() {
    this.dispatchEvent(new Event("open"));
  }

  fail() {
    this.dispatchEvent(new Event("error"));
  }

  emit(event: ArchitectureEvent) {
    this.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event) }));
  }
}
