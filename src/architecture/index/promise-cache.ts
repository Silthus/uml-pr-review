export class PromiseCache<Value> {
  private readonly entries = new Map<string, Promise<Value>>();

  constructor(private readonly capacity: number) {}

  get(key: string, create: () => Promise<Value>): Promise<Value> {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    const created = create();
    this.entries.set(key, created);
    created.catch(() => this.entries.get(key) === created && this.entries.delete(key));
    this.evictBeyondCapacity();
    return created;
  }

  private evictBeyondCapacity() {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.capacity) return;
      this.entries.delete(key);
    }
  }
}
