import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installInterceptor } from "../src/interceptor";
import { _resetObserverState } from "../src/observer";

describe("interceptor", () => {
  let originalAdd: typeof EventTarget.prototype.addEventListener;
  let originalRemove: typeof EventTarget.prototype.removeEventListener;

  beforeEach(() => {
    originalAdd = EventTarget.prototype.addEventListener;
    originalRemove = EventTarget.prototype.removeEventListener;
    _resetObserverState();
  });

  afterEach(() => {
    // Ensure cleanup
    EventTarget.prototype.addEventListener = originalAdd;
    EventTarget.prototype.removeEventListener = originalRemove;
  });

  describe("installInterceptor", () => {
    it("returns a disposable with restore()", () => {
      const disposable = installInterceptor();
      expect(typeof disposable.restore).toBe("function");
      disposable.restore();
    });

    it("patches addEventListener", () => {
      const disposable = installInterceptor();
      expect(EventTarget.prototype.addEventListener).not.toBe(originalAdd);
      disposable.restore();
    });

    it("patches removeEventListener", () => {
      const disposable = installInterceptor();
      expect(EventTarget.prototype.removeEventListener).not.toBe(originalRemove);
      disposable.restore();
    });

    it("restores original methods on restore()", () => {
      const disposable = installInterceptor();
      disposable.restore();
      expect(EventTarget.prototype.addEventListener).toBe(originalAdd);
      expect(EventTarget.prototype.removeEventListener).toBe(originalRemove);
    });

    it("restore is idempotent", () => {
      const disposable = installInterceptor();
      disposable.restore();
      disposable.restore(); // Should not throw
    });

    it("detects double-patch and returns no-op", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const d1 = installInterceptor();
      const d2 = installInterceptor();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Already installed"),
      );

      d1.restore();
      warnSpy.mockRestore();
    });

    it("wraps interaction event handlers", () => {
      const disposable = installInterceptor();
      const handler = vi.fn();
      const el = document.createElement("button");
      document.body.appendChild(el);

      el.addEventListener("click", handler);
      el.click();

      expect(handler).toHaveBeenCalledTimes(1);

      el.removeEventListener("click", handler);
      document.body.removeChild(el);
      disposable.restore();
    });

    it("passes through non-interaction events without wrapping", () => {
      const disposable = installInterceptor();
      const handler = vi.fn();
      const el = document.createElement("div");

      el.addEventListener("scroll", handler);
      el.dispatchEvent(new Event("scroll"));

      expect(handler).toHaveBeenCalledTimes(1);

      el.removeEventListener("scroll", handler);
      disposable.restore();
    });

    it("handles null listener", () => {
      const disposable = installInterceptor();
      const el = document.createElement("div");

      // Should not throw
      el.addEventListener("click", null);
      el.removeEventListener("click", null);

      disposable.restore();
    });

    it("handles EventListenerObject", () => {
      const disposable = installInterceptor();
      const handler = { handleEvent: vi.fn() };
      const el = document.createElement("button");
      document.body.appendChild(el);

      el.addEventListener("click", handler);
      el.click();

      expect(handler.handleEvent).toHaveBeenCalledTimes(1);

      document.body.removeChild(el);
      disposable.restore();
    });

    it("propagates handler errors", () => {
      const disposable = installInterceptor();
      const el = document.createElement("button");
      document.body.appendChild(el);

      el.addEventListener("click", () => {
        throw new Error("handler error");
      });

      expect(() => el.click()).toThrow("handler error");

      document.body.removeChild(el);
      disposable.restore();
    });

    it("respects exclude option", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const disposable = installInterceptor({
        exclude: [".no-snap"],
        debug: true,
      });

      const el = document.createElement("button");
      el.className = "no-snap";
      document.body.appendChild(el);

      const handler = vi.fn();
      el.addEventListener("click", handler);
      el.click();

      // Handler still fires (just not wrapped)
      expect(handler).toHaveBeenCalledTimes(1);

      document.body.removeChild(el);
      disposable.restore();
      debugSpy.mockRestore();
    });

    it("respects custom events option", () => {
      const disposable = installInterceptor({
        events: ["click"],
      });

      const handler = vi.fn();
      const el = document.createElement("button");
      document.body.appendChild(el);

      // keydown should not be intercepted
      el.addEventListener("keydown", handler);
      el.dispatchEvent(new KeyboardEvent("keydown"));
      expect(handler).toHaveBeenCalledTimes(1);

      document.body.removeChild(el);
      disposable.restore();
    });

    it("validates options", () => {
      expect(() => installInterceptor({ threshold: -1 })).toThrow(TypeError);
    });
  });

  describe("removeEventListener", () => {
    it("properly removes wrapped handlers", () => {
      const disposable = installInterceptor();
      const handler = vi.fn();
      const el = document.createElement("button");
      document.body.appendChild(el);

      el.addEventListener("click", handler);
      el.removeEventListener("click", handler);
      el.click();

      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(el);
      disposable.restore();
    });

    it("properly removes wrapped EventListenerObject handlers", () => {
      const disposable = installInterceptor();
      const handler = { handleEvent: vi.fn() };
      const el = document.createElement("button");
      document.body.appendChild(el);

      el.addEventListener("click", handler);
      el.removeEventListener("click", handler);
      el.click();

      expect(handler.handleEvent).not.toHaveBeenCalled();

      document.body.removeChild(el);
      disposable.restore();
    });

    it("handles removing non-tracked handlers", () => {
      const disposable = installInterceptor();
      const handler = vi.fn();
      const el = document.createElement("div");

      // Removing a handler that was never added should not throw
      el.removeEventListener("click", handler);

      disposable.restore();
    });
  });
});
