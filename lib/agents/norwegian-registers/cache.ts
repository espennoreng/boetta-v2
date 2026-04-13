// lib/agents/norwegian-registers/cache.ts
export interface CoordEntry {
  utm33: [number, number];  // [east, north] — EPSG:25833
}

export class CoordCache {
  private map = new Map<string, CoordEntry>();
  constructor(private capacity: number) {}

  get(key: string): CoordEntry | undefined {
    const value = this.map.get(key);
    if (!value) return undefined;
    // refresh LRU order
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: CoordEntry): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

// Module-level singleton used by tool handlers.
export const globalCoordCache = new CoordCache(256);
