import { describe, it, expect, beforeEach } from "vitest";
import { createReport, initReporter, _resetReporterState } from "../src/reporter";
import { _resetObserverState } from "../src/observer";

describe("reporter", () => {
  beforeEach(() => {
    _resetReporterState();
    _resetObserverState();
  });

  describe("createReport", () => {
    it("returns a frozen INPReport", () => {
      const report = createReport();
      expect(Object.isFrozen(report)).toBe(true);
    });

    it("returns zeroed report with no interactions", () => {
      const report = createReport();
      expect(report.inp).toBe(0);
      expect(report.p75).toBe(0);
      expect(report.p99).toBe(0);
      expect(report.interactions).toBe(0);
      expect(report.slowest).toBeNull();
      expect(report.rating).toBe("good");
    });

    it("returns independent snapshot objects", () => {
      const r1 = createReport();
      const r2 = createReport();
      expect(r1).not.toBe(r2);
      expect(r1).toEqual(r2);
    });

    it("has frozen histogram", () => {
      const report = createReport();
      expect(Object.isFrozen(report.histogram)).toBe(true);
    });
  });

  describe("initReporter", () => {
    it("does not throw", () => {
      expect(() => initReporter()).not.toThrow();
    });

    it("resets baseline", () => {
      initReporter();
      const report = createReport();
      expect(report.delta).toBe(0);
    });
  });
});
