import type { ArchitectureEvent } from "../contracts/index.ts";

type WithoutStamp<T> = T extends unknown ? Omit<T, "seq" | "at"> : never;

export type UnstampedEvent = WithoutStamp<ArchitectureEvent>;

export type EventListener = (event: ArchitectureEvent) => void;

export type EventBus = {
  publish(event: UnstampedEvent): ArchitectureEvent;
  subscribe(repositoryId: string, listener: EventListener): () => void;
  listenerCount(repositoryId: string): number;
};

export function createEventBus(clock: () => Date = () => new Date()): EventBus {
  const listeners = new Map<string, Set<EventListener>>();
  let seq = 0;

  function publish(event: UnstampedEvent): ArchitectureEvent {
    const stamped: ArchitectureEvent = { ...event, seq: ++seq, at: clock().toISOString() };
    for (const listener of listeners.get(event.repositoryId) ?? []) listener(stamped);
    return stamped;
  }

  function subscribe(repositoryId: string, listener: EventListener): () => void {
    const subscription = (event: ArchitectureEvent) => listener(event);
    const subscribers = listeners.get(repositoryId) ?? new Set();
    subscribers.add(subscription);
    listeners.set(repositoryId, subscribers);
    return () => {
      subscribers.delete(subscription);
      if (subscribers.size === 0 && listeners.get(repositoryId) === subscribers) listeners.delete(repositoryId);
    };
  }

  return { publish, subscribe, listenerCount: (repositoryId) => listeners.get(repositoryId)?.size ?? 0 };
}
