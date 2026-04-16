import type { DebugEvent, DebugFn, YieldStrategy } from "./types";

/** Default interaction event types that SnapINP intercepts */
export const INTERACTION_EVENTS: ReadonlySet<string> = Object.freeze(
  new Set([
    "click",
    "pointerdown",
    "pointerup",
    "keydown",
    "keyup",
    "input",
    "change",
    "touchstart",
    "touchend",
  ]),
);

/** Schema type for option validation */
type SchemaType = "number" | "boolean" | "string[]" | "string";

const NOOP: DebugFn = () => {};

let cachedStrategy: YieldStrategy | null = null;

/**
 * Detect the best yield mechanism available.
 * Called once at init, result cached in module scope.
 *
 * @returns The best available yield strategy
 *
 * @example
 * ```ts
 * const strategy = detectYieldStrategy();
 * // "scheduler.yield" | "MessageChannel" | "setTimeout"
 * ```
 */
export function detectYieldStrategy(): YieldStrategy {
  if (cachedStrategy !== null) return cachedStrategy;

  if (
    typeof globalThis !== "undefined" &&
    "scheduler" in globalThis
  ) {
    const sched = (globalThis as unknown as Record<string, unknown>)["scheduler"];
    if (
      typeof sched === "object" &&
      sched !== null &&
      typeof (sched as Record<string, unknown>)["yield"] === "function"
    ) {
      cachedStrategy = "scheduler.yield";
    }
  }

  if (cachedStrategy === null && typeof MessageChannel === "function") {
    cachedStrategy = "MessageChannel";
  }

  if (cachedStrategy === null) {
    cachedStrategy = "setTimeout";
  }

  return cachedStrategy;
}

/**
 * Check if an event type is an interaction event.
 *
 * @param type - The event type string
 * @returns True if the event type is a user interaction event
 *
 * @example
 * ```ts
 * isInteractionEvent("click"); // true
 * isInteractionEvent("scroll"); // false
 * ```
 */
export function isInteractionEvent(type: string): boolean {
  return INTERACTION_EVENTS.has(type);
}

/**
 * Check if running in a browser environment.
 *
 * @returns True if window and document are available
 *
 * @example
 * ```ts
 * if (isBrowserEnvironment()) {
 *   // Safe to access DOM APIs
 * }
 * ```
 */
export function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Validate options against a type schema.
 *
 * @param options - The options object to validate
 * @param schema - A map of property names to expected types
 * @returns The validated options cast to T
 * @throws TypeError if any option has the wrong type
 *
 * @example
 * ```ts
 * const opts = validateOptions<SnapOptions>(rawOpts, {
 *   threshold: "number",
 *   debug: "boolean",
 * });
 * ```
 */
export function validateOptions<T>(
  options: unknown,
  schema: Record<string, SchemaType>,
): T {
  if (options === undefined || options === null) return {} as T;
  if (typeof options !== "object") {
    throw new TypeError(`[SnapINP] Expected object, got ${typeof options}`);
  }

  const opts = options as Record<string, unknown>;
  const knownKeys = Object.keys(schema);
  const providedKeys = Object.keys(opts);

  for (const key of providedKeys) {
    if (!knownKeys.includes(key)) {
      // Forward-compat: warn, don't error
      if (typeof console !== "undefined") {
        console.warn(`[SnapINP] Unknown option: ${key}`);
      }
    }
  }

  for (const key of knownKeys) {
    const value = opts[key];
    if (value === undefined) continue;

    const expected = schema[key];
    if (expected === undefined) continue;

    if (expected === "string[]") {
      if (!Array.isArray(value) || !value.every((v: unknown) => typeof v === "string")) {
        throw new TypeError(
          `[SnapINP] "${key}" must be string[], got ${typeof value}`,
        );
      }
    } else if (typeof value !== expected) {
      throw new TypeError(
        `[SnapINP] "${key}" must be ${expected}, got ${typeof value}`,
      );
    }

    if (expected === "number" && (value as number) < 0) {
      throw new TypeError(
        `[SnapINP] "${key}" must be >= 0`,
      );
    }
  }

  return opts as T;
}

/**
 * Generate a minimal CSS selector for an element.
 * Caps depth at 3 ancestors. Never triggers layout reflow.
 *
 * @param el - The event target to generate a selector for
 * @returns A CSS selector string, or "unknown" if not an element
 *
 * @example
 * ```ts
 * const sel = generateSelector(event.target);
 * // "button#submit.primary"
 * ```
 */
export function generateSelector(el: EventTarget | null): string {
  if (el === null || !isElement(el)) return "unknown";

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current !== null && depth < 3) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${current.id}`;
      parts.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/);
      if (classes.length > 0 && classes[0] !== "") {
        selector += `.${classes.slice(0, 2).join(".")}`;
      }
    }

    parts.unshift(selector);
    // Stop at shadow root boundary
    const parentEl: Element | null = current.parentElement;
    if (parentEl === null) break;
    current = parentEl;
    depth++;
  }

  return parts.join(" > ") || "unknown";
}

/**
 * Create a debug logging function.
 * Returns a complete no-op when debug is false (pre-assigned empty function, not a conditional check).
 *
 * @param namespace - The namespace prefix for log messages
 * @param enabled - Whether debug logging is enabled
 * @returns A debug logging function
 *
 * @example
 * ```ts
 * const debug = createDebugger("interceptor", true);
 * debug("intercept", { type: "click" });
 * // console.debug: [SnapINP:interceptor] intercept { type: "click" }
 * ```
 */
export function createDebugger(namespace: string, enabled: boolean = false): DebugFn {
  if (!enabled) return NOOP;

  return (event: DebugEvent, data?: unknown): void => {
    console.debug(`[SnapINP:${namespace}]`, event, data);
  };
}

/**
 * Get current high-resolution time with SSR fallback.
 *
 * @returns Current timestamp in milliseconds
 *
 * @example
 * ```ts
 * const start = now();
 * // ... work ...
 * const elapsed = now() - start;
 * ```
 */
export function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function isElement(target: EventTarget): target is Element {
  return typeof (target as Element).tagName === "string";
}

/**
 * Reset the cached yield strategy (for testing only).
 * @internal
 */
export function _resetCachedStrategy(): void {
  cachedStrategy = null;
}
