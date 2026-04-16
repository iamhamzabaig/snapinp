import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createObserver,
  getCurrentINP,
  getRating,
  getInteractions,
  getInteractionCount,
  _resetObserverState,
} from "../src/observer";

class FakePerformanceObserver {
  static supportedEntryTypes = ["event"];
  static instances: FakePerformanceObserver[] = [];
  private readonly cb: PerformanceObserverCallback;

  constructor(cb: PerformanceObserverCallback) {
    this.cb = cb;
    FakePerformanceObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {}

  emit(entries: PerformanceEntry[]): void {
    const list = { getEntries: () => entries } as PerformanceObserverEntryList;
    this.cb(list, this as unknown as PerformanceObserver);
  }
}

function createEventEntry(
  interactionId: number,
  duration: number,
  startTime: number,
): PerformanceEntry {
  const processingStart = startTime + 2;
  const processingEnd = startTime + Math.min(duration, 12);
  const target = document.createElement("button");

  return {
    name: "click",
    entryType: "event",
    startTime,
    duration,
    processingStart,
    processingEnd,
    interactionId,
    target,
    toJSON() {
      return {};
    },
  } as unknown as PerformanceEntry;
}

describe("observer", () => {
  const originalPO = globalThis.PerformanceObserver;

  beforeEach(() => {
    _resetObserverState();
    FakePerformanceObserver.instances = [];
    (globalThis as unknown as { PerformanceObserver: typeof PerformanceObserver })
      .PerformanceObserver = FakePerformanceObserver as unknown as typeof PerformanceObserver;
  });

  afterEach(() => {
    _resetObserverState();
    if (originalPO === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).PerformanceObserver;
    } else {
      (globalThis as unknown as { PerformanceObserver: typeof PerformanceObserver })
        .PerformanceObserver = originalPO;
    }
  });

  describe("getRating", () => {
    it("returns 'good' for INP <= 200", () => {
      expect(getRating(0)).toBe("good");
      expect(getRating(100)).toBe("good");
      expect(getRating(200)).toBe("good");
    });

    it("returns 'needs-improvement' for 200 < INP <= 500", () => {
      expect(getRating(201)).toBe("needs-improvement");
      expect(getRating(350)).toBe("needs-improvement");
      expect(getRating(500)).toBe("needs-improvement");
    });

    it("returns 'poor' for INP > 500", () => {
      expect(getRating(501)).toBe("poor");
      expect(getRating(1000)).toBe("poor");
    });
  });

  describe("getCurrentINP", () => {
    it("returns 0 when no state", () => {
      expect(getCurrentINP()).toBe(0);
    });

    it("returns 0 with null state", () => {
      expect(getCurrentINP(null)).toBe(0);
    });
  });

  describe("getInteractions", () => {
    it("returns empty array when no state", () => {
      expect(getInteractions()).toEqual([]);
    });
  });

  describe("getInteractionCount", () => {
    it("returns 0 when no state", () => {
      expect(getInteractionCount()).toBe(0);
    });
  });

  describe("createObserver", () => {
    it("returns a disposable", () => {
      const callback = vi.fn();
      const disposable = createObserver(callback);
      expect(typeof disposable.restore).toBe("function");
      expect(typeof disposable.disconnect).toBe("function");
      disposable.disconnect!();
    });

    it("disconnect is idempotent", () => {
      const callback = vi.fn();
      const disposable = createObserver(callback);
      disposable.disconnect!();
      disposable.disconnect!(); // should not throw
    });

    it("restore calls disconnect", () => {
      const callback = vi.fn();
      const disposable = createObserver(callback);
      disposable.restore();
    });
  });

  describe("event processing", () => {
    it("reorders interactions when an existing interaction gets slower", () => {
      const callback = vi.fn();
      const disposable = createObserver(callback);
      const instance = FakePerformanceObserver.instances[0];
      expect(instance).toBeDefined();

      instance!.emit([createEventEntry(1, 100, 10)]);
      instance!.emit([createEventEntry(2, 90, 20)]);
      expect(getCurrentINP()).toBe(100);

      instance!.emit([createEventEntry(2, 120, 25)]);

      const tracked = getInteractions();
      expect(tracked[0]?.duration).toBe(120);
      expect(getCurrentINP()).toBe(120);
      expect(callback).toHaveBeenCalledTimes(3);
      disposable.disconnect!();
    });

    it("keeps interaction map and buffer bounded to 200 entries", () => {
      const disposable = createObserver(() => {});
      const instance = FakePerformanceObserver.instances[0];
      expect(instance).toBeDefined();

      for (let i = 1; i <= 250; i++) {
        instance!.emit([createEventEntry(i, i, i * 5)]);
      }

      expect(getInteractions().length).toBe(200);
      expect(getInteractionCount()).toBe(200);
      disposable.disconnect!();
    });
  });
});
