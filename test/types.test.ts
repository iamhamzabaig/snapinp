import { describe, it, expect } from "vitest";
import type {
  SnapOptions,
  WrapOptions,
  INPMetric,
  INPReport,
  Disposable,
  YieldStrategy,
  DebugEvent,
} from "../src/types";

describe("types", () => {
  it("SnapOptions accepts valid options", () => {
    const opts: SnapOptions = {
      threshold: 50,
      events: ["click", "keydown"],
      exclude: [".no-snap"],
      adaptive: true,
      debug: false,
    };
    expect(opts.threshold).toBe(50);
  });

  it("SnapOptions allows all-optional", () => {
    const opts: SnapOptions = {};
    expect(opts.threshold).toBeUndefined();
  });

  it("WrapOptions accepts threshold", () => {
    const opts: WrapOptions = { threshold: 30 };
    expect(opts.threshold).toBe(30);
  });

  it("INPMetric has required fields", () => {
    const metric: INPMetric = {
      inp: 100,
      eventType: "click",
      target: "button#submit",
      processingTime: 80,
      inputDelay: 10,
      presentationDelay: 10,
      timestamp: 1000,
      id: "123-1000",
    };
    expect(metric.inp).toBe(100);
    expect(metric.id).toBe("123-1000");
  });

  it("INPReport has required fields", () => {
    const report: INPReport = {
      inp: 150,
      p75: 120,
      p99: 300,
      improved: true,
      delta: 50,
      interactions: 10,
      slowest: null,
      histogram: { click: 3 },
      rating: "good",
    };
    expect(report.rating).toBe("good");
  });

  it("Disposable has restore and optional disconnect", () => {
    const disposable: Disposable = {
      restore() {},
      disconnect() {},
    };
    expect(typeof disposable.restore).toBe("function");
    expect(typeof disposable.disconnect).toBe("function");
  });

  it("YieldStrategy covers all strategies", () => {
    const strategies: YieldStrategy[] = ["scheduler.yield", "MessageChannel", "setTimeout"];
    expect(strategies).toHaveLength(3);
  });

  it("DebugEvent covers all events", () => {
    const events: DebugEvent[] = ["intercept", "yield", "skip", "restore", "warn", "metric"];
    expect(events).toHaveLength(6);
  });
});
