import type { ArchitectureEvent } from "../contracts/index.ts";
import type { EventBus } from "../events/index.ts";

const keepaliveMilliseconds = 15_000;
const encoder = new TextEncoder();

export function eventStream(bus: EventBus, repositoryId: string, signal: AbortSignal): Response {
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const unsubscribe = bus.subscribe(repositoryId, (event) => send(frameOf(event)));
      const keepalive = setInterval(() => send(": keepalive\n\n"), keepaliveMilliseconds);
      stop = () => {
        unsubscribe();
        clearInterval(keepalive);
      };
      signal.addEventListener("abort", () => stop());
      send(": connected\n\n");
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

function frameOf(event: ArchitectureEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
