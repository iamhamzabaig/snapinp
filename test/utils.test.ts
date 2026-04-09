import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectYieldStrategy,
  isInteractionEvent,
  isBrowserEnvironment,
  validateOptions,
  generateSelector,
  createDebugger,
  now,
  INTERACTION_EVENTS,
  _resetCachedStrategy,
} from "../src/utils";

describe("utils", () => {
  describe("INTERACTION_EVENTS", () => {
    it("contains all 9 interaction events", () => {
      expect(INTERACTION_EVENTS.size).toBe(9);
      expect(INTERACTION_EVENTS.has("click")).toBe(true);
      expect(INTERACTION_EVENTS.has("pointerdown")).toBe(true);
      expect(INTERACTION_EVENTS.has("pointerup")).toBe(true);
      expect(INTERACTION_EVENTS.has("keydown")).toBe(true);
      expect(INTERACTION_EVENTS.has("keyup")).toBe(true);
      expect(INTERACTION_EVENTS.has("input")).toBe(true);
      expect(INTERACTION_EVENTS.has("change")).toBe(true);
      expect(INTERACTION_EVENTS.has("touchstart")).toBe(true);
      expect(INTERACTION_EVENTS.has("touchend")).toBe(true);
    });

    it("does not contain non-interaction events", () => {
      expect(INTERACTION_EVENTS.has("scroll")).toBe(false);
      expect(INTERACTION_EVENTS.has("resize")).toBe(false);
      expect(INTERACTION_EVENTS.has("mousemove")).toBe(false);
    });

    it("is frozen", () => {
      expect(Object.isFrozen(INTERACTION_EVENTS)).toBe(true);
    });
  });

  describe("detectYieldStrategy", () => {
    beforeEach(() => {
      _resetCachedStrategy();
    });

    it("returns MessageChannel when available", () => {
      const result = detectYieldStrategy();
      // happy-dom has MessageChannel
      expect(["scheduler.yield", "MessageChannel", "setTimeout"]).toContain(result);
    });

    it("caches the result", () => {
      const first = detectYieldStrategy();
      const second = detectYieldStrategy();
      expect(first).toBe(second);
    });

    it("returns setTimeout as last resort", () => {
      const origMC = globalThis.MessageChannel;
      // @ts-expect-error testing fallback
      delete globalThis.MessageChannel;
      _resetCachedStrategy();

      const result = detectYieldStrategy();
      expect(result).toBe("setTimeout");

      globalThis.MessageChannel = origMC;
      _resetCachedStrategy();
    });
  });

  describe("isInteractionEvent", () => {
    it("returns true for interaction events", () => {
      expect(isInteractionEvent("click")).toBe(true);
      expect(isInteractionEvent("keydown")).toBe(true);
      expect(isInteractionEvent("touchstart")).toBe(true);
    });

    it("returns false for non-interaction events", () => {
      expect(isInteractionEvent("scroll")).toBe(false);
      expect(isInteractionEvent("resize")).toBe(false);
      expect(isInteractionEvent("mousemove")).toBe(false);
      expect(isInteractionEvent("")).toBe(false);
    });
  });

  describe("isBrowserEnvironment", () => {
    it("returns true in happy-dom", () => {
      expect(isBrowserEnvironment()).toBe(true);
    });
  });

  describe("validateOptions", () => {
    it("returns empty object for undefined input", () => {
      const result = validateOptions<{ threshold?: number }>(undefined, {
        threshold: "number",
      });
      expect(result).toEqual({});
    });

    it("returns empty object for null input", () => {
      const result = validateOptions<{ threshold?: number }>(null, {
        threshold: "number",
      });
      expect(result).toEqual({});
    });

    it("throws for non-object input", () => {
      expect(() => validateOptions("string", { threshold: "number" })).toThrow(TypeError);
    });

    it("validates number type", () => {
      const result = validateOptions<{ threshold?: number }>({ threshold: 50 }, {
        threshold: "number",
      });
      expect(result.threshold).toBe(50);
    });

    it("throws for wrong number type", () => {
      expect(() =>
        validateOptions({ threshold: "fifty" }, { threshold: "number" }),
      ).toThrow(TypeError);
    });

    it("throws for negative number", () => {
      expect(() =>
        validateOptions({ threshold: -1 }, { threshold: "number" }),
      ).toThrow(TypeError);
    });

    it("validates boolean type", () => {
      const result = validateOptions<{ debug?: boolean }>({ debug: true }, {
        debug: "boolean",
      });
      expect(result.debug).toBe(true);
    });

    it("throws for wrong boolean type", () => {
      expect(() =>
        validateOptions({ debug: "true" }, { debug: "boolean" }),
      ).toThrow(TypeError);
    });

    it("validates string array type", () => {
      const result = validateOptions<{ events?: string[] }>(
        { events: ["click", "keydown"] },
        { events: "string[]" },
      );
      expect(result.events).toEqual(["click", "keydown"]);
    });

    it("throws for non-array string[]", () => {
      expect(() =>
        validateOptions({ events: "click" }, { events: "string[]" }),
      ).toThrow(TypeError);
    });

    it("throws for array with non-strings", () => {
      expect(() =>
        validateOptions({ events: [1, 2] }, { events: "string[]" }),
      ).toThrow(TypeError);
    });

    it("warns on unknown keys but does not throw", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      validateOptions({ unknown: true }, { threshold: "number" });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown option"),
      );
      warnSpy.mockRestore();
    });

    it("allows undefined values for known keys", () => {
      const result = validateOptions<{ threshold?: number }>(
        { threshold: undefined },
        { threshold: "number" },
      );
      expect(result.threshold).toBeUndefined();
    });
  });

  describe("generateSelector", () => {
    it("returns 'unknown' for null", () => {
      expect(generateSelector(null)).toBe("unknown");
    });

    it("returns tag name for plain element", () => {
      const el = document.createElement("div");
      expect(generateSelector(el)).toBe("div");
    });

    it("includes id when present", () => {
      const el = document.createElement("button");
      el.id = "submit";
      expect(generateSelector(el)).toBe("button#submit");
    });

    it("includes class names (max 2)", () => {
      const el = document.createElement("div");
      el.className = "foo bar baz";
      expect(generateSelector(el)).toBe("div.foo.bar");
    });

    it("builds ancestor path (max 3 depth)", () => {
      const grandparent = document.createElement("section");
      const parent = document.createElement("div");
      const child = document.createElement("span");
      grandparent.appendChild(parent);
      parent.appendChild(child);
      document.body.appendChild(grandparent);

      const sel = generateSelector(child);
      expect(sel).toContain("span");
      expect(sel).toContain(">");

      document.body.removeChild(grandparent);
    });

    it("stops at element with id", () => {
      const parent = document.createElement("div");
      parent.id = "container";
      const child = document.createElement("span");
      parent.appendChild(child);
      document.body.appendChild(parent);

      const sel = generateSelector(child);
      expect(sel).toContain("div#container");

      document.body.removeChild(parent);
    });

    it("returns 'unknown' for non-element EventTarget", () => {
      const target = new EventTarget();
      expect(generateSelector(target)).toBe("unknown");
    });
  });

  describe("createDebugger", () => {
    it("returns no-op when disabled", () => {
      const debug = createDebugger("test", false);
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      debug("intercept", { test: true });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("logs when enabled", () => {
      const debug = createDebugger("test", true);
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      debug("intercept", { test: true });
      expect(spy).toHaveBeenCalledWith("[SnapINP:test]", "intercept", { test: true });
      spy.mockRestore();
    });

    it("defaults to disabled", () => {
      const debug = createDebugger("test");
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      debug("intercept");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("now", () => {
    it("returns a positive number", () => {
      expect(now()).toBeGreaterThan(0);
    });

    it("returns increasing values", () => {
      const a = now();
      const b = now();
      expect(b).toBeGreaterThanOrEqual(a);
    });
  });
});
