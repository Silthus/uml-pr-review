import type { ArchitectureEvent } from "../contracts/index.ts";

type WithoutStamp<T> = T extends unknown ? Omit<T, "seq" | "at"> : never;

export type UnstampedEvent = WithoutStamp<ArchitectureEvent>;

export type EventListener = (event: ArchitectureEvent) => void;

export type EventBus = {
  publish(event: UnstampedEvent): ArchitectureEvent;
  subscribe(repositoryId: string, listener: EventListener): () => void;
};

export function createEventBus(clock: () => Date = () => new Date()): EventBus {
  const listeners = new Map<string, Set<EventListener>>();
  let seq = 0;

  function publish(event: UnstampedEvent): ArchitectureEvent {
    const stamped = { ...event, seq: ++seq, at: clock().toISOString() } as ArchitectureEvent;
    for (const listener of listeners.get(event.repositoryId) ?? []) listener(stamped);
    return stamped;
  }

  function subscribe(repositoryId: string, listener: EventListener): () => void {
    const subscribers = listeners.get(repositoryId) ?? new Set();
    subscribers.add(listener);
    listeners.set(repositoryId, subscribers);
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) listeners.delete(repositoryId);
    };
  }

  return { publish, subscribe };
}
