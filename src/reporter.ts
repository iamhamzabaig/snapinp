import type { INPMetric, INPReport, DebugFn } from "./types";
import {
  createObserver,
  getCurrentINP,
  getRating,
  getInteractions,
  getInteractionCount,
} from "./observer";
import { isBrowserEnvironment, now, createDebugger } from "./utils";

/** Baseline tracking state */
interface ReporterState {
  baseline: number | null;
  baselineWindowEnd: number;
  beaconRegistered: boolean;
  beaconUrl: string | null;
  debug: DebugFn;
}

let reporterState: ReporterState | null = null;

const BASELINE_WINDOW_MS = 5000;

function getOrCreateReporterState(debug?: DebugFn): ReporterState {
  if (reporterState !== null) return reporterState;

  return (reporterState = {
    baseline: null,
    baselineWindowEnd: now() + BASELINE_WINDOW_MS,
    beaconRegistered: false,
    beaconUrl: null,
    debug: debug ?? createDebugger("reporter"),
  });
}

function buildHistogram(interactions: readonly { duration: number; eventType: string }[]): Readonly<Record<string, number>> {
  const histogram: Record<string, number> = {};

  for (const interaction of interactions) {
    if (interaction.duration > 200) {
      const type = interaction.eventType;
      histogram[type] = (histogram[type] ?? 0) + 1;
    }
  }

  return Object.freeze(histogram);
}

function getPercentile(
  interactions: readonly { duration: number }[],
  percentile: number,
): number {
  if (interactions.length === 0) return 0;
  const idx = Math.min(
    interactions.length - 1,
    Math.ceil((percentile / 100) * interactions.length) - 1,
  );
  const interaction = interactions[Math.max(0, idx)];
  return interaction !== undefined ? interaction.duration : 0;
}

function buildSlowest(interactions: readonly {
  id: string;
  duration: number;
  eventType: string;
  target: string;
  processingTime: number;
  inputDelay: number;
  presentationDelay: number;
  startTime: number;
}[]): INPMetric | null {
  if (interactions.length === 0) return null;
  const worst = interactions[0];
  if (worst === undefined) return null;

  return Object.freeze({
    inp: worst.duration,
    eventType: worst.eventType,
    target: worst.target,
    processingTime: worst.processingTime,
    inputDelay: worst.inputDelay,
    presentationDelay: worst.presentationDelay,
    timestamp: worst.startTime,
    id: worst.id,
  });
}

/**
 * Create a snapshot report of current INP metrics.
 *
 * @param options - Optional beacon URL and metric callback
 * @returns A frozen INPReport snapshot
 *
 * @example
 * ```ts
 * const r = createReport();
 * console.log(`INP: ${r.inp}ms (${r.rating})`);
 * ```
 */
export function createReport(options?: {
  beacon?: string;
  onMetric?: (m: INPMetric) => void;
}): INPReport {
  if (!isBrowserEnvironment()) {
    return Object.freeze({
      inp: 0,
      p75: 0,
      p99: 0,
      improved: false,
      delta: 0,
      interactions: 0,
      slowest: null,
      histogram: Object.freeze({}),
      rating: "good" as const,
    });
  }

  const rs = getOrCreateReporterState();
  const interactions = getInteractions();
  const currentINP = getCurrentINP();

  // Baseline tracking
  if (rs.baseline === null && now() < rs.baselineWindowEnd) {
    rs.baseline = currentINP;
  } else if (rs.baseline === null) {
    rs.baseline = currentINP;
  }

  const delta = rs.baseline - currentINP;
  const improved = delta > 0;

  // Register beacon if requested
  if (options?.beacon !== undefined && !rs.beaconRegistered) {
    rs.beaconUrl = options.beacon;
    rs.beaconRegistered = true;
    registerBeacon(rs);
  }

  // Register metric callback
  if (options?.onMetric !== undefined) {
    createObserver(options.onMetric);
  }

  return Object.freeze({
    inp: currentINP,
    p75: getPercentile(interactions, 75),
    p99: getPercentile(interactions, 99),
    improved,
    delta,
    interactions: getInteractionCount(),
    slowest: buildSlowest(interactions),
    histogram: buildHistogram(interactions),
    rating: getRating(currentINP),
  });
}

function registerBeacon(rs: ReporterState): void {
  if (typeof document === "undefined") return;

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden" && rs.beaconUrl !== null) {
        try {
          const reportData = createReport();
          const blob = new Blob([JSON.stringify(reportData)], {
            type: "application/json",
          });
          navigator.sendBeacon(rs.beaconUrl, blob);
        } catch (_e: unknown) {
          // Best-effort beacon, ignore failures
        }
      }
    },
    { once: false, capture: false },
  );
}

/**
 * Initialize the reporter baseline window.
 * Called by snap() to start the baseline tracking clock.
 *
 * @param debug - Debug function
 */
export function initReporter(debug?: DebugFn): void {
  const rs = getOrCreateReporterState(debug);
  rs.baselineWindowEnd = now() + BASELINE_WINDOW_MS;
  rs.baseline = null;
}

/**
 * Reset reporter state (for testing only).
 * @internal
 */
export function _resetReporterState(): void {
  reporterState = null;
}
