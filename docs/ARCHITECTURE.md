# Architecture

## Module Dependency Graph

```
index.ts (public API surface)
  ├── interceptor.ts → scheduler.ts, utils.ts, types.ts
  ├── scheduler.ts   → utils.ts, types.ts
  ├── observer.ts    → utils.ts, types.ts
  ├── reporter.ts    → observer.ts, utils.ts, types.ts
  ├── types.ts       (leaf — no imports from project)
  └── utils.ts       (leaf — no imports from project)
```

**No circular imports.** This is enforced by convention and by the build.

**Tree-shaking rule:** `observer.ts` never imports from `interceptor.ts` or `scheduler.ts`. The feedback loop (observer tells interceptor to back off) uses callback injection via `setFeedbackCallback()`. This ensures `import { observe } from 'snapinp'` doesn't pull in patching code.

## Module Responsibilities

### `types.ts`
Shared interfaces and type definitions. The ONLY file other modules import types from. No runtime code.

### `utils.ts`
Pure utility functions: feature detection, validation, selector generation, debug logging, timing. No side effects on import. No DOM access at module scope.

### `scheduler.ts`
The yield engine. Provides:
- `createYielder(strategy)` — factory returning a strategy-bound yield function
- `wrapWithScheduler(handler, threshold, yielder, debug)` — wraps handlers with auto-yield
- `yieldToMain()` — public cooperative yield point

**Yield strategies (in priority order):**
1. `scheduler.yield()` — Chrome 129+. Preserves task priority.
2. `MessageChannel` — All modern browsers. Yields to macrotask queue.
3. `setTimeout(0)` — Universal fallback. Subject to 4ms clamping.

### `observer.ts`
INP measurement via `PerformanceObserver({ type: 'event' })`. Groups entries by `interactionId`, computes per-interaction metrics, maintains a bounded sorted buffer (max 200 entries).

**INP calculation:** Take worst interaction, but if ≥50 interactions, drop single worst (matches Chrome's algorithm).

**Feedback injection:** Accepts a `FeedbackCallback` via `setFeedbackCallback()` — never imports interceptor directly.

### `reporter.ts`
Aggregates observer data into `INPReport` snapshots. Tracks baseline INP for delta calculation. Provides beacon support via `navigator.sendBeacon`.

### `interceptor.ts`
Monkey-patches `EventTarget.prototype.addEventListener` / `removeEventListener`. The most dangerous module.

**Safety mechanisms:**
- Double-patch detection via Symbol sentinel
- Original method preservation in closure scope
- 3-level WeakMap for handler tracking (handler → target → type → wrapped)
- WeakMap/Map method references stored at init (prototype pollution defense)
- Idempotent `restore()`

### `index.ts`
Public API surface. Re-exports only the 5 public functions and types. Internal modules are not accessible.

## Monkey-Patching Order

SnapINP saves whatever is currently on `EventTarget.prototype.addEventListener` when `snap()` is called. This means:

1. If Zone.js (Angular) loads first → SnapINP wraps Zone's version → works fine
2. If SnapINP loads first → Zone.js overwrites SnapINP → SnapINP is disabled
3. If another library patches AFTER SnapINP → calling `restore()` will break that library

**Recommendation:** Initialize SnapINP LAST, or use `wrap()` manual mode.

## Data Flow

```
User clicks button
  → Patched addEventListener fires wrapped handler
    → performance.now() before
    → Original handler runs
    → performance.now() after
    → If async + over threshold → yield via strategy → continue
    → If sync + over threshold → debug warning
  → PerformanceObserver receives PerformanceEventTiming
    → Grouped by interactionId
    → INP recalculated
    → Feedback callback fires (adaptive mode)
    → Metric callbacks fire
```

## web-vitals Compatibility

SnapINP's `INPReport` maps to web-vitals format:

| SnapINP field   | web-vitals equivalent |
| --------------- | --------------------- |
| `report.inp`    | `metric.value`        |
| `report.rating` | `metric.rating`       |
| `report.p75`    | N/A                   |
| `report.delta`  | `metric.delta`        |
| `metric.id`     | `metric.id`           |
