import { ArchitectureEventSchema, type ArchitectureEvent } from "../../../src/architecture/contracts/index.ts";

export type EventStream = { next(count: number): Promise<ArchitectureEvent[]>; close(): Promise<void> };

export async function openEventStream(response: Response): Promise<EventStream> {
  if (response.headers.get("content-type") !== "text/event-stream") throw new Error(`Expected an event stream, got ${response.status}: ${await response.text()}`);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const received: ArchitectureEvent[] = [];
  let buffer = "";

  async function next(count: number): Promise<ArchitectureEvent[]> {
    while (received.length < count) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`The event stream ended after ${received.length} of ${count} events.`);
      buffer += value;
      const frames = buffer.split("\n\n");
      buffer = frames.pop()!;
      received.push(...frames.flatMap(eventOf));
    }
    return received.splice(0, count);
  }

  return { next, close: () => reader.cancel() };
}

function eventOf(frame: string): ArchitectureEvent[] {
  const fields = new Map(frame.split("\n").flatMap((line) => (line.startsWith(":") ? [] : [[line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)] as const])));
  if (!fields.has("data")) return [];
  const event = ArchitectureEventSchema.parse(JSON.parse(fields.get("data")!));
  if (fields.get("event") !== event.type || fields.get("id") !== String(event.seq)) throw new Error(`Frame fields do not match its data: ${frame}`);
  return [event];
}
