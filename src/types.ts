/** Options for snap() auto-mode */
export interface SnapOptions {
  /** Milliseconds before yielding (default: 50) */
  readonly threshold?: number | undefined;
  /** Which events to intercept (default: INTERACTION_EVENTS) */
  readonly events?: readonly string[] | undefined;
  /** CSS selectors — handlers on matching targets are skipped */
  readonly exclude?: readonly string[] | undefined;
  /** Back off when INP is already good (default: true) */
  readonly adaptive?: boolean | undefined;
  /** Structured debug logging (default: false) */
  readonly debug?: boolean | undefined;
}

/** Options for wrap() manual mode */
export interface WrapOptions {
  /** Milliseconds before yielding (default: 50) */
  readonly threshold?: number | undefined;
}

/** Single interaction metric */
export interface INPMetric {
  readonly inp: number;
  readonly eventType: string;
  /** CSS selector path to target element */
  readonly target: string;
  readonly processingTime: number;
  readonly inputDelay: number;
  readonly presentationDelay: number;
  readonly timestamp: number;
  /** Unique interaction ID for deduplication */
  readonly id: string;
}

/** Aggregated report */
export interface INPReport {
  /** Current INP (p75 of worst-per-interaction) */
  readonly inp: number;
  readonly p75: number;
  readonly p99: number;
  readonly improved: boolean;
  /** Baseline minus current (positive = improvement) */
  readonly delta: number;
  readonly interactions: number;
  readonly slowest: INPMetric | null;
  /** Event type → count of slow interactions */
  readonly histogram: Readonly<Record<string, number>>;
  readonly rating: "good" | "needs-improvement" | "poor";
}

/** Disposable pattern for all subscriptions */
export interface Disposable {
  /** Restore original behavior (for interceptor) */
  restore(): void;
  /** Disconnect observer */
  disconnect?(): void;
}

/** Yield strategy detected at init */
export type YieldStrategy = "scheduler.yield" | "MessageChannel" | "setTimeout";

/** Debug event types */
export type DebugEvent = "intercept" | "yield" | "skip" | "restore" | "warn" | "metric";

/** Debug function signature */
export type DebugFn = (event: DebugEvent, data?: unknown) => void;

/** Feedback callback from observer to interceptor */
export type FeedbackCallback = (
  eventType: string,
  rating: "good" | "needs-improvement" | "poor",
) => void;
