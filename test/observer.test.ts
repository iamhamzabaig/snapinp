import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createObserver,
  getCurrentINP,
  getRating,
  getInteractions,
  getInteractionCount,
  _resetObserverState,
} from "../src/observer";

describe("observer", () => {
  beforeEach(() => {
    _resetObserverState();
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
});
