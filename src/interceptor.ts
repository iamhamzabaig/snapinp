import type { SnapOptions, Disposable, YieldStrategy } from "./types";
import { wrapWithScheduler, createYielder } from "./scheduler";
import {
  INTERACTION_EVENTS,
  createDebugger,
  detectYieldStrategy,
  isBrowserEnvironment,
  validateOptions,
} from "./utils";
import { setFeedbackCallback } from "./observer";

/** Sentinel symbol — not visible in for...in, Object.keys, JSON.stringify */
const SENTINEL = Symbol("__snapinp__");

// Store WeakMap/Map methods at init for prototype pollution defense
// Stored at init for prototype pollution defense
const wmProto = { get: WeakMap.prototype.get, set: WeakMap.prototype.set };
const mapProto = { get: Map.prototype.get, set: Map.prototype.set, del: Map.prototype.delete };

/** Handler mapping: originalHandler → target → eventType → wrappedHandler */
let handlerMap = new WeakMap<Function, WeakMap<EventTarget, Map<string, Function>>>();

/** Stored originals */
let originalAddEventListener: typeof EventTarget.prototype.addEventListener | null = null;
let originalRemoveEventListener: typeof EventTarget.prototype.removeEventListener | null =
  null;

/** Whether we're currently patched */
let patched = false;

/** Set of event types we're intercepting */
let interceptedEvents: ReadonlySet<string> = INTERACTION_EVENTS;

/** Exclude selectors */
let excludeSelectors: readonly string[] = [];

/** Adaptive mode feedback state */
const goodEventTypes = new Set<string>();

/** Options schema for validation */
const SNAP_OPTIONS_SCHEMA: Record<string, "number" | "boolean" | "string[]" | "string"> = {
  threshold: "number",
  events: "string[]",
  exclude: "string[]",
  adaptive: "boolean",
  debug: "boolean",
};

function getWrapped(
  handler: Function,
  target: EventTarget,
  type: string,
): Function | undefined {
  const targetMap = wmProto.get.call(handlerMap, handler) as
    | WeakMap<EventTarget, Map<string, Function>>
    | undefined;
  if (targetMap === undefined) return undefined;
  const typeMap = wmProto.get.call(targetMap, target) as Map<string, Function> | undefined;
  if (typeMap === undefined) return undefined;
  return mapProto.get.call(typeMap, type) as Function | undefined;
}

function setWrapped(
  handler: Function,
  target: EventTarget,
  type: string,
  wrapped: Function,
): void {
  let targetMap = wmProto.get.call(handlerMap, handler) as
    | WeakMap<EventTarget, Map<string, Function>>
    | undefined;
  if (targetMap === undefined) {
    targetMap = new WeakMap();
    wmProto.set.call(handlerMap, handler, targetMap);
  }
  let typeMap = wmProto.get.call(targetMap, target) as Map<string, Function> | undefined;
  if (typeMap === undefined) {
    typeMap = new Map();
    wmProto.set.call(targetMap, target, typeMap);
  }
  mapProto.set.call(typeMap, type, wrapped);
}

function deleteWrapped(
  handler: Function,
  target: EventTarget,
  type: string,
): void {
  const targetMap = wmProto.get.call(handlerMap, handler) as
    | WeakMap<EventTarget, Map<string, Function>>
    | undefined;
  if (targetMap === undefined) return;
  const typeMap = wmProto.get.call(targetMap, target) as Map<string, Function> | undefined;
  if (typeMap === undefined) return;
  mapProto.del.call(typeMap, type);
}

function isExcluded(target: EventTarget): boolean {
  if (excludeSelectors.length === 0) return false;
  if (!(target instanceof Element)) return false;

  for (const selector of excludeSelectors) {
    try {
      if (target.matches(selector)) return true;
    } catch (_e: unknown) {
      // Invalid selector — skip
    }
  }
  return false;
}

function extractHandler(
  listener: EventListenerOrEventListenerObject | null,
): Function | null {
  if (listener === null) return null;
  if (typeof listener === "function") return listener;
  if (typeof listener === "object" && typeof listener.handleEvent === "function") {
    return listener.handleEvent.bind(listener);
  }
  return null;
}

/**
 * Install the interceptor by monkey-patching EventTarget.prototype.
 *
 * @param options - Configuration options
 * @returns A Disposable that restores the original methods
 *
 * @example
 * ```ts
 * const { restore } = installInterceptor({ threshold: 50, debug: true });
 * // ... later:
 * restore();
 * ```
 */
export function installInterceptor(options?: SnapOptions): Disposable {
  if (!isBrowserEnvironment()) {
    return { restore() {} };
  }

  // Double-patch detection
  const currentAdd = EventTarget.prototype
    .addEventListener as unknown as Record<symbol, boolean>;
  if (currentAdd[SENTINEL] === true) {
    console.warn("[SnapINP] Already installed — returning no-op.");
    return { restore() {} };
  }

  const opts = validateOptions<SnapOptions>(options, SNAP_OPTIONS_SCHEMA);
  const threshold = opts.threshold ?? 50;
  const debug = createDebugger("interceptor", opts.debug ?? false);
  const adaptive = opts.adaptive ?? true;

  if (opts.events !== undefined) {
    interceptedEvents = new Set(opts.events);
  } else {
    interceptedEvents = INTERACTION_EVENTS;
  }

  if (opts.exclude !== undefined) {
    excludeSelectors = opts.exclude;
  } else {
    excludeSelectors = [];
  }

  // Create yielder
  const strategy: YieldStrategy = detectYieldStrategy();
  const yielder = createYielder(strategy);

  debug("intercept", { strategy, threshold, adaptive });

  // Store originals (may already be patched by Zone.js, jQuery, etc.)
  originalAddEventListener = EventTarget.prototype.addEventListener;
  originalRemoveEventListener = EventTarget.prototype.removeEventListener;

  // Set up adaptive feedback
  if (adaptive) {
    goodEventTypes.clear();
    setFeedbackCallback((eventType, rating) => {
      if (rating === "good") {
        goodEventTypes.add(eventType);
      } else {
        goodEventTypes.delete(eventType);
      }
    });
  }

  // Patch addEventListener
  const patchedAdd = function addEventListener(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    optionsOrCapture?: boolean | AddEventListenerOptions,
  ): void {
    // Null listener is a browser-accepted no-op
    if (listener === null) {
      originalAddEventListener!.call(this, type, listener, optionsOrCapture);
      return;
    }

    // Non-interaction events: zero overhead passthrough
    if (!interceptedEvents.has(type)) {
      originalAddEventListener!.call(this, type, listener, optionsOrCapture);
      return;
    }

    // Excluded targets
    if (isExcluded(this)) {
      debug("skip", { type, reason: "excluded" });
      originalAddEventListener!.call(this, type, listener, optionsOrCapture);
      return;
    }

    // Adaptive: skip if already good
    if (adaptive && goodEventTypes.has(type)) {
      debug("skip", { type, reason: "adaptive-good" });
      originalAddEventListener!.call(this, type, listener, optionsOrCapture);
      return;
    }

    const handler = extractHandler(listener);
    if (handler === null) {
      originalAddEventListener!.call(this, type, listener, optionsOrCapture);
      return;
    }

    // Wrap the handler
    const wrapped = wrapWithScheduler(handler, threshold, yielder, debug);
    setWrapped(handler, this, type, wrapped);

    // Normalize options
    let resolvedOptions = optionsOrCapture;

    // Passive hints for touch events
    if (type === "touchstart" || type === "touchmove") {
      if (typeof resolvedOptions === "boolean") {
        resolvedOptions = { capture: resolvedOptions, passive: true };
      } else if (resolvedOptions === undefined) {
        resolvedOptions = { passive: true };
      } else if (typeof resolvedOptions === "object") {
        if ((resolvedOptions as AddEventListenerOptions).passive !== false) {
          resolvedOptions = { ...resolvedOptions, passive: true };
        }
      }
    }

    // Handle 'once' option — clean up WeakMap on first invocation
    if (
      typeof resolvedOptions === "object" &&
      resolvedOptions !== null &&
      (resolvedOptions as AddEventListenerOptions).once === true
    ) {
      const onceWrapped = function (this: EventTarget, ...args: unknown[]) {
        deleteWrapped(handler, this, type);
        return (wrapped as Function).apply(this, args);
      };
      Object.defineProperty(onceWrapped, "length", {
        value: wrapped.length,
        configurable: true,
      });
      setWrapped(handler, this, type, onceWrapped);
      originalAddEventListener!.call(
        this,
        type,
        onceWrapped as EventListener,
        resolvedOptions,
      );
      return;
    }

    originalAddEventListener!.call(this, type, wrapped as EventListener, resolvedOptions);
  };

  // Patch removeEventListener
  const patchedRemove = function removeEventListener(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    optionsOrCapture?: boolean | EventListenerOptions,
  ): void {
    if (listener === null) {
      originalRemoveEventListener!.call(this, type, listener, optionsOrCapture);
      return;
    }

    const handler = typeof listener === "function"
      ? listener
      : typeof listener === "object" && listener !== null && typeof listener.handleEvent === "function"
        ? listener.handleEvent
        : null;

    if (handler !== null) {
      const wrapped = getWrapped(handler, this, type);
      if (wrapped !== undefined) {
        deleteWrapped(handler, this, type);
        originalRemoveEventListener!.call(this, type, wrapped as EventListener, optionsOrCapture);
        return;
      }
    }

    // Not in our map — call original (registered before SnapINP, or non-interaction)
    originalRemoveEventListener!.call(this, type, listener, optionsOrCapture);
  };

  // Install patches
  Object.defineProperty(EventTarget.prototype, "addEventListener", {
    value: patchedAdd,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(EventTarget.prototype, "removeEventListener", {
    value: patchedRemove,
    writable: true,
    configurable: true,
  });

  // Set sentinel (non-enumerable Symbol)
  Object.defineProperty(patchedAdd, SENTINEL, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: true,
  });

  patched = true;

  // Return disposable
  return {
    restore() {
      if (!patched) return; // Idempotent

      // Restore originals
      if (originalAddEventListener !== null) {
        Object.defineProperty(EventTarget.prototype, "addEventListener", {
          value: originalAddEventListener,
          writable: true,
          configurable: true,
        });
      }

      if (originalRemoveEventListener !== null) {
        Object.defineProperty(EventTarget.prototype, "removeEventListener", {
          value: originalRemoveEventListener,
          writable: true,
          configurable: true,
        });
      }

      // Clear state
      handlerMap = new WeakMap();
      goodEventTypes.clear();
      setFeedbackCallback(null);
      originalAddEventListener = null;
      originalRemoveEventListener = null;
      patched = false;

      debug("restore", { message: "SnapINP interceptor restored" });
    },
  };
}
