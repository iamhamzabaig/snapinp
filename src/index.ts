import type { SnapOptions, WrapOptions, INPMetric, INPReport, Disposable } from "./types";
import { isBrowserEnvironment, validateOptions, createDebugger, detectYieldStrategy } from "./utils";
import { installInterceptor } from "./interceptor";
import { createObserver } from "./observer";
import { createReport, initReporter } from "./reporter";
import { wrapWithScheduler, createYielder, yieldToMain as yieldFn } from "./scheduler";

export type { SnapOptions, WrapOptions, INPMetric, INPReport, Disposable };

/**
 * Auto-mode: patches addEventListener to automatically yield during long interactions.
 * One line to improve your INP score.
 *
 * @param options - Configuration options
 * @returns A Disposable with restore() to undo all patches
 * @throws TypeError if options are invalid
 *
 * @example
 * ```ts
 * import { snap } from "snapinp";
 * const { restore } = snap();
 * // All interaction handlers now auto-yield
 * // Call restore() to undo
 * ```
 */
export function snap(options?: SnapOptions): Disposable {
  if (!isBrowserEnvironment()) return { restore() {} };

  // Validation happens inside installInterceptor
  initReporter(createDebugger("reporter", (options as SnapOptions | undefined)?.debug ?? false));

  return installInterceptor(options);
}

/**
 * Manual mode: wrap a single function to auto-yield when it exceeds the threshold.
 * Use this for targeted optimization without global patching.
 *
 * @param fn - The function to wrap
 * @param options - Optional configuration
 * @returns The wrapped function with the same signature
 * @throws TypeError if fn is not a function or options are invalid
 *
 * @example
 * ```ts
 * import { wrap } from "snapinp";
 * const optimizedHandler = wrap(expensiveHandler, { threshold: 30 });
 * button.addEventListener("click", optimizedHandler);
 * ```
 */
export function wrap<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options?: WrapOptions,
): T {
  if (!isBrowserEnvironment()) return fn;

  if (typeof fn !== "function") {
    throw new TypeError(`[SnapINP] wrap() expects a function, got ${typeof fn}`);
  }

  const opts = validateOptions<WrapOptions>(options, { threshold: "number" });
  const yielder = createYielder(detectYieldStrategy());

  return wrapWithScheduler(fn, opts.threshold ?? 50, yielder, createDebugger("wrap")) as T;
}

/**
 * Cooperative yield point. Call `await yieldToMain()` inside async handlers
 * to give the browser a chance to paint between chunks of work.
 * This is the RECOMMENDED approach for optimal INP.
 *
 * @returns A promise that resolves after yielding to the browser's rendering pipeline
 *
 * @example
 * ```ts
 * import { yieldToMain } from "snapinp";
 *
 * async function handleSearch(query: string) {
 *   updateSearchUI(query);       // instant visual feedback
 *   await yieldToMain();         // let the browser paint
 *   const results = search(query); // expensive work
 *   renderResults(results);
 * }
 * ```
 */
export function yieldToMain(): Promise<void> {
  if (!isBrowserEnvironment()) return Promise.resolve();
  return yieldFn();
}

/**
 * Observe INP metrics without any patching.
 * Tree-shakes cleanly — does not pull in interceptor or scheduler code.
 *
 * @param callback - Called with each new INP metric
 * @returns A Disposable with disconnect() to stop observing
 *
 * @example
 * ```ts
 * import { observe } from "snapinp";
 * const { disconnect } = observe((metric) => {
 *   console.log(`INP: ${metric.inp}ms on ${metric.target}`);
 * });
 * ```
 */
export function observe(callback: (metric: INPMetric) => void): Disposable {
  if (!isBrowserEnvironment()) {
    return {
      restore() {},
      disconnect() {},
    };
  }

  return createObserver(callback);
}

/**
 * Get a snapshot report of current INP metrics.
 * Optionally register a beacon to send metrics when the page is hidden.
 *
 * @param options - Optional beacon URL and metric callback
 * @returns A frozen INPReport snapshot
 *
 * @example
 * ```ts
 * import { report } from "snapinp";
 * const r = report({ beacon: "/api/vitals" });
 * console.log(`INP: ${r.inp}ms (${r.rating}), improved: ${r.improved}`);
 * ```
 */
export function report(options?: {
  beacon?: string;
  onMetric?: (m: INPMetric) => void;
}): INPReport {
  return createReport(options);
}
