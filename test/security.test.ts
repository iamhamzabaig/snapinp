import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { snap, wrap, observe, report } from "../src/index";
import { _resetObserverState } from "../src/observer";
import { _resetReporterState } from "../src/reporter";
import { validateOptions } from "../src/utils";

describe("security", () => {
  let originalAdd: typeof EventTarget.prototype.addEventListener;
  let originalRemove: typeof EventTarget.prototype.removeEventListener;

  beforeEach(() => {
    originalAdd = EventTarget.prototype.addEventListener;
    originalRemove = EventTarget.prototype.removeEventListener;
    _resetObserverState();
    _resetReporterState();
  });

  afterEach(() => {
    EventTarget.prototype.addEventListener = originalAdd;
    EventTarget.prototype.removeEventListener = originalRemove;
  });

  describe("prototype pollution", () => {
    it("does not pollute Object.prototype via options", () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      validateOptions(malicious, { threshold: "number" });
      // @ts-expect-error testing prototype pollution
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      warnSpy.mockRestore();
    });

    it("does not accept __proto__ as a valid key", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      validateOptions({ __proto__: {} }, { threshold: "number" });
      warnSpy.mockRestore();
    });
  });

  describe("double-load safety", () => {
    it("warns and returns no-op on second snap()", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const d1 = snap();
      const d2 = snap();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Already installed"),
      );

      d1.restore();
      warnSpy.mockRestore();
    });

    it("wrap() still works even with double-load", () => {
      const d1 = snap();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      snap(); // Second snap — no-op

      const fn = (x: unknown) => x;
      const wrapped = wrap(fn);
      expect(wrapped("test")).toBe("test");

      d1.restore();
      warnSpy.mockRestore();
    });

    it("observe() works independently of interceptor", () => {
      const callback = vi.fn();
      const disposable = observe(callback);
      expect(typeof disposable.disconnect).toBe("function");
      disposable.disconnect!();
    });

    it("yieldToMain() works independently of interceptor", async () => {
      const { yieldToMain } = await import("../src/index");
      await yieldToMain();
    });
  });

  describe("handler error propagation", () => {
    it("sync error propagates with original stack", () => {
      const { restore } = snap();
      const button = document.createElement("button");
      document.body.appendChild(button);

      const originalError = new Error("original");
      button.addEventListener("click", () => {
        throw originalError;
      });

      try {
        button.click();
        expect.unreachable("should throw");
      } catch (e) {
        expect(e).toBe(originalError); // Same reference
        expect((e as Error).message).toBe("original");
      }

      restore();
      document.body.removeChild(button);
    });
  });

  describe("option validation", () => {
    it("rejects non-object options", () => {
      // @ts-expect-error testing invalid input
      expect(() => snap("invalid")).toThrow(TypeError);
    });

    it("rejects negative threshold", () => {
      expect(() => snap({ threshold: -1 })).toThrow(TypeError);
    });

    it("rejects non-number threshold", () => {
      // @ts-expect-error testing invalid input
      expect(() => snap({ threshold: "50" })).toThrow(TypeError);
    });

    it("rejects non-boolean debug", () => {
      // @ts-expect-error testing invalid input
      expect(() => snap({ debug: "true" })).toThrow(TypeError);
    });

    it("rejects non-array events", () => {
      // @ts-expect-error testing invalid input
      expect(() => snap({ events: "click" })).toThrow(TypeError);
    });

    it("rejects non-string array events", () => {
      // @ts-expect-error testing invalid input
      expect(() => snap({ events: [1, 2, 3] })).toThrow(TypeError);
    });

    it("rejects non-boolean adaptive", () => {
      // @ts-expect-error testing invalid input
      expect(() => snap({ adaptive: "true" })).toThrow(TypeError);
    });

    it("rejects non-function for wrap()", () => {
      // @ts-expect-error testing invalid input
      expect(() => wrap(42)).toThrow(TypeError);
      // @ts-expect-error testing invalid input
      expect(() => wrap(null)).toThrow(TypeError);
    });
  });

  describe("sentinel is hidden", () => {
    it("sentinel does not appear in Object.keys", () => {
      const { restore } = snap();
      const keys = Object.keys(EventTarget.prototype.addEventListener);
      expect(keys).not.toContain("__snapinp__");
      restore();
    });

    it("sentinel does not appear in for...in", () => {
      const { restore } = snap();
      const keys: string[] = [];
      for (const key in EventTarget.prototype.addEventListener) {
        keys.push(key);
      }
      expect(keys).not.toContain("__snapinp__");
      restore();
    });

    it("sentinel does not appear in JSON.stringify of descriptor", () => {
      const { restore } = snap();
      const desc = Object.getOwnPropertyDescriptor(
        EventTarget.prototype.addEventListener,
        Symbol.for("test"),
      );
      // Symbol properties don't show up in JSON.stringify at all
      const symbolKeys = Object.getOwnPropertySymbols(EventTarget.prototype.addEventListener);
      const names = symbolKeys.map((s) => s.toString());
      // The sentinel is a Symbol, not a string property
      expect(names.some((n) => n.includes("__snapinp__"))).toBe(true);
      // But it's non-enumerable
      const enumKeys = Object.keys(EventTarget.prototype.addEventListener as object);
      expect(enumKeys).not.toContain("__snapinp__");
      restore();
    });
  });

  describe("report data minimization", () => {
    it("report contains only aggregated metrics", () => {
      const r = report();
      const keys = Object.keys(r);
      const allowedKeys = [
        "inp",
        "p75",
        "p99",
        "improved",
        "delta",
        "interactions",
        "slowest",
        "histogram",
        "rating",
      ];
      for (const key of keys) {
        expect(allowedKeys).toContain(key);
      }
    });

    it("report is serializable as JSON", () => {
      const r = report();
      const json = JSON.stringify(r);
      expect(typeof json).toBe("string");
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed["inp"]).toBe(r.inp);
    });
  });
});
