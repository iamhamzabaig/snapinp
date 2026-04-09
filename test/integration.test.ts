import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { snap, wrap, yieldToMain, observe, report } from "../src/index";
import { _resetObserverState } from "../src/observer";
import { _resetReporterState } from "../src/reporter";

describe("integration", () => {
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

  describe("snap() end-to-end", () => {
    it("patches, handles click, and restores", () => {
      const { restore } = snap();
      const handler = vi.fn();
      const button = document.createElement("button");
      document.body.appendChild(button);

      button.addEventListener("click", handler);
      button.click();

      expect(handler).toHaveBeenCalledTimes(1);

      restore();
      document.body.removeChild(button);
    });

    it("returns no-op for invalid options after throwing", () => {
      expect(() => snap({ threshold: -1 })).toThrow(TypeError);
    });

    it("snap with debug mode", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const { restore } = snap({ debug: true });

      expect(debugSpy).toHaveBeenCalled();

      restore();
      debugSpy.mockRestore();
    });
  });

  describe("wrap()", () => {
    it("wraps a function and preserves return value", () => {
      const original = (x: unknown) => x;
      const wrapped = wrap(original);
      expect(wrapped("hello")).toBe("hello");
    });

    it("preserves this binding", () => {
      const obj = {
        value: 42,
        getValue(this: { value: number }) {
          return this.value;
        },
      };
      obj.getValue = wrap(obj.getValue);
      expect(obj.getValue()).toBe(42);
    });

    it("throws for non-function", () => {
      // @ts-expect-error testing invalid input
      expect(() => wrap("not a function")).toThrow(TypeError);
    });
  });

  describe("yieldToMain()", () => {
    it("resolves as a promise", async () => {
      await yieldToMain();
    });
  });

  describe("observe()", () => {
    it("returns a disposable with disconnect", () => {
      const callback = vi.fn();
      const disposable = observe(callback);
      expect(typeof disposable.restore).toBe("function");
      expect(typeof disposable.disconnect).toBe("function");
      disposable.disconnect!();
    });
  });

  describe("report()", () => {
    it("returns a valid report", () => {
      const r = report();
      expect(r).toHaveProperty("inp");
      expect(r).toHaveProperty("rating");
      expect(r).toHaveProperty("histogram");
      expect(Object.isFrozen(r)).toBe(true);
    });
  });

  describe("handler error propagation", () => {
    it("errors reach the caller exactly", () => {
      const { restore } = snap();
      const button = document.createElement("button");
      document.body.appendChild(button);

      const error = new Error("user error");
      button.addEventListener("click", () => {
        throw error;
      });

      try {
        button.click();
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBe(error); // Same reference, not wrapped
      }

      restore();
      document.body.removeChild(button);
    });
  });
});
