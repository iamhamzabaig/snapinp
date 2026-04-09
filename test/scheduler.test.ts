import { describe, it, expect, vi } from "vitest";
import { createYielder, wrapWithScheduler, yieldToMain } from "../src/scheduler";
import type { DebugFn } from "../src/types";

describe("scheduler", () => {
  const noopDebug: DebugFn = () => {};

  describe("createYielder", () => {
    it("creates a MessageChannel yielder", async () => {
      const yielder = createYielder("MessageChannel");
      expect(typeof yielder).toBe("function");
      await yielder(); // Should resolve
    });

    it("resolves overlapping MessageChannel yields", async () => {
      const yielder = createYielder("MessageChannel");
      await expect(Promise.all([yielder(), yielder(), yielder()])).resolves.toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    });

    it("creates a setTimeout yielder", async () => {
      const yielder = createYielder("setTimeout");
      expect(typeof yielder).toBe("function");
      await yielder(); // Should resolve
    });

    it("yielder resolves as a promise", async () => {
      const yielder = createYielder("setTimeout");
      const result = yielder();
      expect(result).toBeInstanceOf(Promise);
      await result;
    });
  });

  describe("wrapWithScheduler", () => {
    it("returns a new function", () => {
      const original = () => {};
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(original, 50, yielder, noopDebug);
      expect(wrapped).not.toBe(original);
      expect(typeof wrapped).toBe("function");
    });

    it("preserves .length", () => {
      const original = (_a: unknown, _b: unknown, _c: unknown) => {};
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(original, 50, yielder, noopDebug);
      expect(wrapped.length).toBe(3);
    });

    it("calls the original handler with correct this and arguments", () => {
      const spy = vi.fn();
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(spy, 50, yielder, noopDebug);

      const context = { name: "test" };
      wrapped.call(context, "arg1", "arg2");

      expect(spy).toHaveBeenCalledWith("arg1", "arg2");
      expect(spy.mock.instances[0]).toBe(context);
    });

    it("returns the original return value for sync handlers", () => {
      const original = () => 42;
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(original, 50, yielder, noopDebug);
      expect(wrapped()).toBe(42);
    });

    it("propagates errors from sync handlers", () => {
      const original = () => {
        throw new Error("test error");
      };
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(original, 50, yielder, noopDebug);
      expect(() => wrapped()).toThrow("test error");
    });

    it("handles async handlers", async () => {
      const original = async () => "async result";
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(original, 50, yielder, noopDebug);
      const result = await (wrapped() as Promise<string>);
      expect(result).toBe("async result");
    });

    it("warns for slow sync handlers", () => {
      const debugSpy = vi.fn();
      const original = () => {
        // Simulate slow work
        const start = performance.now();
        while (performance.now() - start < 60) {
          // busy wait
        }
      };
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(original, 50, yielder, debugSpy);
      wrapped();
      expect(debugSpy).toHaveBeenCalledWith("warn", expect.objectContaining({
        elapsed: expect.any(Number),
      }));
    });

    it("returns non-promise values untouched", () => {
      const original = () => ({ key: "value" });
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(original, 50, yielder, noopDebug);
      const result = wrapped() as { key: string };
      expect(result).toEqual({ key: "value" });
    });

    it("returns undefined for void handlers", () => {
      const original = () => {};
      const yielder = createYielder("setTimeout");
      const wrapped = wrapWithScheduler(original, 50, yielder, noopDebug);
      expect(wrapped()).toBeUndefined();
    });
  });

  describe("yieldToMain", () => {
    it("returns a promise", () => {
      const result = yieldToMain();
      expect(result).toBeInstanceOf(Promise);
    });

    it("resolves successfully", async () => {
      await yieldToMain();
    });
  });
});
