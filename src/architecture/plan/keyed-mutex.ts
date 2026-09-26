export type KeyedMutex = <T>(key: string, work: () => Promise<T>) => Promise<T>;

export function keyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<void>>();
  return (key, work) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(work);
    const tail = run.then(ignore, ignore);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

function ignore(): void {}
