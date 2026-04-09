import type { Disposable, FeedbackCallback, INPMetric, DebugFn } from "./types";
import { createDebugger, generateSelector, isBrowserEnvironment, now } from "./utils";

/** Max stored interactions (bounded circular buffer) */
const MAX_INTERACTIONS = 200;

interface InteractionGroup {
  readonly id: string;
  duration: number;
  eventType: string;
  target: string;
  processingTime: number;
  inputDelay: number;
  presentationDelay: number;
  startTime: number;
}

interface ObserverState {
  interactions: InteractionGroup[];
  interactionMap: Map<number, InteractionGroup>;
  callbacks: Set<(metric: INPMetric) => void>;
  feedbackFn: FeedbackCallback | null;
  observer: PerformanceObserver | null;
  debug: DebugFn;
}

let state: ObserverState | null = null;

function getOrCreateState(debug?: DebugFn): ObserverState {
  if (state !== null) return state;

  return (state = {
    interactions: [],
    interactionMap: new Map(),
    callbacks: new Set(),
    feedbackFn: null,
    observer: null,
    debug: debug ?? createDebugger("observer"),
  });
}

function processEntry(
  entry: PerformanceEventTiming,
  s: ObserverState,
): void {
  const interactionId = entry.interactionId;
  if (interactionId === undefined || interactionId === 0) return;

  const processingTime = entry.processingEnd - entry.processingStart;
  const inputDelay = entry.processingStart - entry.startTime;
  const presentationDelay = entry.duration - (entry.processingEnd - entry.startTime);
  const targetSelector = entry.target ? generateSelector(entry.target) : "unknown";

  const existing = s.interactionMap.get(interactionId);

  if (existing !== undefined) {
    // Same interaction, multiple events — keep longest duration
    if (entry.duration > existing.duration) {
      existing.duration = entry.duration;
      existing.eventType = entry.name;
      existing.target = targetSelector;
      existing.processingTime = processingTime;
      existing.inputDelay = inputDelay;
      existing.presentationDelay = presentationDelay;
      existing.startTime = entry.startTime;
    }
    return;
  }

  const group: InteractionGroup = {
    id: `${interactionId}-${entry.startTime.toFixed(0)}`,
    duration: entry.duration,
    eventType: entry.name,
    target: targetSelector,
    processingTime,
    inputDelay,
    presentationDelay,
    startTime: entry.startTime,
  };

  s.interactionMap.set(interactionId, group);

  // Bounded insertion: keep sorted by duration descending
  if (s.interactions.length < MAX_INTERACTIONS) {
    s.interactions.push(group);
  } else {
    // Replace the smallest (last) if this is larger
    const last = s.interactions[s.interactions.length - 1];
    if (last !== undefined && group.duration > last.duration) {
      s.interactions[s.interactions.length - 1] = group;
    } else {
      return; // Not significant enough to track
    }
  }

  // Sort descending by duration
  s.interactions.sort((a, b) => b.duration - a.duration);

  // Build metric
  const metric: INPMetric = Object.freeze({
    inp: group.duration,
    eventType: group.eventType,
    target: group.target,
    processingTime: group.processingTime,
    inputDelay: group.inputDelay,
    presentationDelay: group.presentationDelay,
    timestamp: now(),
    id: group.id,
  });

  s.debug("metric", metric);

  // Notify callbacks
  for (const cb of s.callbacks) {
    try {
      cb(metric);
    } catch (_e: unknown) {
      // Internal error containment — don't let callback errors break observer
      if (typeof console !== "undefined") {
        console.error("[SnapINP internal error] Callback threw:", _e);
      }
    }
  }

  // Feedback for adaptive mode
  if (s.feedbackFn !== null) {
    const rating = getRating(getCurrentINP(s));
    s.feedbackFn(group.eventType, rating);
  }
}

/**
 * Calculate current INP from stored interactions.
 * Chrome INP: worst interaction, but if ≥50, drop the single worst.
 */
export function getCurrentINP(s?: ObserverState | null): number {
  const st = s ?? state;
  if (st === null || st.interactions.length === 0) return 0;

  const idx = Math.min(
    st.interactions.length - 1,
    Math.floor(st.interactions.length / 50),
  );
  const interaction = st.interactions[idx];
  return interaction !== undefined ? interaction.duration : 0;
}

/**
 * Get the INP rating based on Google's thresholds.
 *
 * @param inp - The INP value in milliseconds
 * @returns The rating category
 */
export function getRating(inp: number): "good" | "needs-improvement" | "poor" {
  if (inp <= 200) return "good";
  if (inp <= 500) return "needs-improvement";
  return "poor";
}

/**
 * Get all stored interactions (for reporter).
 */
export function getInteractions(): readonly InteractionGroup[] {
  if (state === null) return [];
  return state.interactions;
}

/**
 * Get interaction count.
 */
export function getInteractionCount(): number {
  if (state === null) return 0;
  return state.interactionMap.size;
}

function startObserver(s: ObserverState): void {
  if (s.observer !== null) return;
  if (!isBrowserEnvironment()) return;

  try {
    if (typeof PerformanceObserver === "undefined") {
      s.debug("warn", { message: "PerformanceObserver not available" });
      return;
    }

    // Check if 'event' type is supported
    const supported = PerformanceObserver.supportedEntryTypes;
    if (!supported || !supported.includes("event")) {
      s.debug("warn", { message: "PerformanceObserver 'event' type not supported" });
      return;
    }

    s.observer = new PerformanceObserver((list) => {
      const entries = list.getEntries() as PerformanceEventTiming[];
      for (const entry of entries) {
        processEntry(entry, s);
      }
    });

    s.observer.observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  } catch (e: unknown) {
    s.debug("warn", { message: "Failed to create PerformanceObserver", error: e });
  }
}

/**
 * Set the feedback callback for adaptive mode.
 * This is the dependency-injection point — observer never imports interceptor.
 *
 * @param fn - Callback that receives event type and INP rating
 */
export function setFeedbackCallback(fn: FeedbackCallback | null): void {
  const s = getOrCreateState();
  s.feedbackFn = fn;
}

/**
 * Observe INP metrics. Starts the PerformanceObserver lazily on first call.
 *
 * @param callback - Called with each new INP metric
 * @param debug - Optional debug function
 * @returns Disposable to disconnect the observer
 *
 * @example
 * ```ts
 * const { disconnect } = createObserver((metric) => {
 *   console.log("INP:", metric.inp);
 * });
 * ```
 */
export function createObserver(
  callback: (metric: INPMetric) => void,
  debug?: DebugFn,
): Disposable {
  const s = getOrCreateState(debug);
  s.callbacks.add(callback);
  startObserver(s);

  return {
    restore() {
      this.disconnect?.();
    },
    disconnect() {
      s.callbacks.delete(callback);
      if (s.callbacks.size === 0 && s.observer !== null) {
        s.observer.disconnect();
        s.observer = null;
      }
    },
  };
}

/**
 * Reset observer state (for testing only).
 * @internal
 */
export function _resetObserverState(): void {
  if (state !== null) {
    if (state.observer !== null) {
      state.observer.disconnect();
    }
    state = null;
  }
}

// Type augmentation for PerformanceEventTiming (not in all TS libs)
interface PerformanceEventTiming extends PerformanceEntry {
  readonly processingStart: number;
  readonly processingEnd: number;
  readonly interactionId?: number;
  readonly target: EventTarget | null;
}
