import type { DebugFn, YieldStrategy } from "./types";
import { detectYieldStrategy, now } from "./utils";

/**
 * Create a yield function bound to the detected strategy.
 * The factory is called ONCE. The channel/timer is reused. No allocation per yield.
 *
 * @param strategy - The yield strategy to use
 * @returns A function that yields to the main thread
 *
 * @example
 * ```ts
 * const yielder = createYielder("MessageChannel");
 * await yielder(); // yields to browser rendering pipeline
 * ```
 */
export function createYielder(strategy: YieldStrategy): () => Promise<void> {
  if (strategy === "scheduler.yield") {
    return () =>
      (globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler.yield();
  }

  if (strategy === "MessageChannel") {
    const channel = new MessageChannel();
    const queue: Array<() => void> = [];

    channel.port1.onmessage = () => {
      const resolve = queue.shift();
      if (resolve !== undefined) {
        resolve();
      }
    };

    return () =>
      new Promise<void>((r) => {
        queue.push(r);
        channel.port2.postMessage(null);
      });
  }

  // setTimeout fallback
  return () => new Promise<void>((r) => setTimeout(r, 0));
}

/**
 * Wrap a handler to auto-yield when it exceeds the threshold.
 * Returns a NEW function; never mutates the original.
 * Preserves `this` binding, arguments, `.length`, and error propagation.
 *
 * @param handler - The original event handler
 * @param threshold - Milliseconds before yielding is suggested
 * @param yielder - The yield function from createYielder
 * @param debug - Debug logging function
 * @returns A wrapped handler that auto-yields for async handlers
 *
 * @example
 * ```ts
 * const wrapped = wrapWithScheduler(onClick, 50, yielder, debug);
 * ```
 */
export function wrapWithScheduler(
  handler: Function,
  threshold: number,
  yielder: () => Promise<void>,
  debug: DebugFn,
): Function {
  function wrappedHandler(this: unknown, ...args: unknown[]): unknown {
    const start = now();
    let result: unknown;

    try {
      result = handler.apply(this, args);
    } catch (e: unknown) {
      // Error propagation: never swallow, never wrap
      throw e;
    }

    const elapsed = now() - start;

    // Async handler: attach yield continuation
    if (result !== null && result !== undefined && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then((val: unknown) => {
        const totalElapsed = now() - start;
        if (totalElapsed > threshold) {
          debug("yield", { elapsed: totalElapsed, type: "async" });
          return yielder().then(() => val);
        }
        return val;
      });
    }

    // Sync handler that took too long: warn (can't retroactively fix)
    if (elapsed > threshold) {
      debug("warn", {
        message: `Sync handler: ${elapsed.toFixed(1)}ms > ${threshold}ms. Use yieldToMain().`,
        elapsed,
      });
    }

    return result;
  }

  // Preserve .length
  Object.defineProperty(wrappedHandler, "length", {
    value: handler.length,
    configurable: true,
  });

  return wrappedHandler;
}

let defaultYielder: (() => Promise<void>) | null = null;

/**
 * Cooperative yield point. Users call `await yieldToMain()` inside
 * their own async handlers to create explicit yield points.
 * This is the RECOMMENDED path for optimal INP.
 *
 * @returns A promise that resolves after yielding to the browser
 *
 * @example
 * ```ts
 * async function handleClick() {
 *   doQuickUIUpdate();
 *   await yieldToMain();
 *   doExpensiveWork();
 * }
 * ```
 */
export function yieldToMain(): Promise<void> {
  if (defaultYielder === null) {
    defaultYielder = createYielder(detectYieldStrategy());
  }
  return defaultYielder();
}
