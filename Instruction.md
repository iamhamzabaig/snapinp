I'm building **SnapINP** — an open-source JavaScript/TypeScript library that automatically optimizes Interaction to Next Paint (INP). This is **critical infrastructure** — assume thousands of production sites will depend on it. Every design decision must account for backward compatibility, hostile environments, framework interop, and long-term maintainability. Engineer it like you're shipping a load-bearing dependency to the npm ecosystem.

---

## Step 1: Generate CLAUDE.md

Generate a `CLAUDE.md` at project root as the persistent context for all future Claude Code sessions. Everything below must be captured in it.

---

### 1. Project Identity

- **Name:** SnapINP
- **Tagline:** "One line. Instant UI. Every interaction."
- **Mission:** Automatically fix INP scores by intercepting event handlers and yielding to the browser's rendering pipeline between chunks of work. The user sees instant visual feedback; heavy computation still completes — cooperatively, not blockingly.
- **Non-goals:** SnapINP is NOT a general-purpose task scheduler, NOT a framework, NOT a polyfill for `scheduler.yield()`. It solves exactly one problem: making interactions feel instant.
- **Target:** <3KB gzipped total, <1KB for observe-only path. Zero dependencies. TypeScript-first. Ships ESM + CJS + IIFE.
- **License:** MIT
- **Minimum browser support:** Chrome 90+, Firefox 95+, Safari 15.4+, Edge 90+. Graceful no-op in Node.js / SSR / Web Workers.

---

### 2. Architecture

#### 2.1 Module Dependency Graph (enforced — no circular imports)

```
index.ts (public API surface)
  ├── interceptor.ts → scheduler.ts, utils.ts, types.ts
  ├── scheduler.ts   → utils.ts, types.ts
  ├── observer.ts    → utils.ts, types.ts
  ├── reporter.ts    → observer.ts, utils.ts, types.ts
  ├── types.ts       (leaf — no imports from project)
  └── utils.ts       (leaf — no imports from project)
```

**Rule:** `observer.ts` must NEVER import from `interceptor.ts` or `scheduler.ts`. The feedback loop (observer tells interceptor to back off) uses a callback injection pattern, not a direct import. This ensures `import { observe } from 'snapinp'` tree-shakes cleanly without pulling in the patching machinery.

#### 2.2 Module Specifications

**`src/types.ts`** — Shared interfaces and type definitions. This is the ONLY file other modules import types from. No runtime code.

```typescript
/** Options for snap() auto-mode */
export interface SnapOptions {
  threshold?: number; // ms before yielding (default: 50)
  events?: readonly string[]; // which events to intercept (default: INTERACTION_EVENTS)
  exclude?: readonly string[]; // CSS selectors — handlers on matching targets are skipped
  adaptive?: boolean; // back off when INP is already good (default: true)
  debug?: boolean; // structured debug logging (default: false)
}

/** Options for wrap() manual mode */
export interface WrapOptions {
  threshold?: number;
}

/** Single interaction metric */
export interface INPMetric {
  readonly inp: number;
  readonly eventType: string;
  readonly target: string; // CSS selector path to target element
  readonly processingTime: number;
  readonly inputDelay: number;
  readonly presentationDelay: number;
  readonly timestamp: number;
  readonly id: string; // unique interaction ID for deduplication
}

/** Aggregated report */
export interface INPReport {
  readonly inp: number; // current INP (p75 of worst-per-interaction)
  readonly p75: number;
  readonly p99: number;
  readonly improved: boolean;
  readonly delta: number; // baseline minus current (positive = improvement)
  readonly interactions: number;
  readonly slowest: INPMetric | null;
  readonly histogram: Readonly<Record<string, number>>; // event type → count of slow interactions
  readonly rating: "good" | "needs-improvement" | "poor";
}

/** Disposable pattern for all subscriptions */
export interface Disposable {
  restore(): void; // for interceptor
  disconnect?(): void; // for observer
}

// Internal — not exported from index.ts
export type YieldStrategy = "scheduler.yield" | "MessageChannel" | "setTimeout";
export type DebugEvent =
  | "intercept"
  | "yield"
  | "skip"
  | "restore"
  | "warn"
  | "metric";
```

**`src/utils.ts`** — Pure utility functions, feature detection, validation. No side effects on import. No DOM access.

Must include:

- `detectYieldStrategy(): YieldStrategy` — feature-detect best yield mechanism. Called once at init, result cached in module scope. Detection order: `typeof globalThis.scheduler?.yield === 'function'` → `typeof MessageChannel === 'function'` → `'setTimeout'`.
- `isInteractionEvent(type: string): boolean` — returns true for click, pointerdown, pointerup, keydown, keyup, input, change, touchstart, touchend. Uses a frozen Set for O(1) lookup.
- `isBrowserEnvironment(): boolean` — checks for `typeof window !== 'undefined' && typeof document !== 'undefined'`. Returns false in Node.js, SSR, Web Workers.
- `validateOptions<T>(options: unknown, schema: Record<string, 'number' | 'boolean' | 'string[]' | 'string'>): T` — runtime validation with descriptive TypeErrors. Schema is a simple type map, not a validation library.
- `generateSelector(el: EventTarget | null): string` — generates a minimal CSS selector path for an element (tag#id.class). Must NOT trigger layout reflow. Never reads computed styles. Caps depth at 3 ancestors to avoid perf issues.
- `createDebugger(namespace: string): (event: DebugEvent, data?: unknown) => void` — returns a logging function that is a complete no-op when `debug: false`. The no-op is a pre-assigned empty function reference, NOT a conditional check per call. In debug mode, uses `console.debug` with structured data and `[SnapINP]` prefix.
- `now(): number` — alias for `performance.now()` with SSR fallback to `Date.now()`.
- `INTERACTION_EVENTS: ReadonlySet<string>` — frozen set of default interaction event types.

**`src/scheduler.ts`** — The yield engine. This is the most critical module. Every line must be reviewed for correctness.

Behavior specification:

1. **`createYielder(strategy: YieldStrategy): () => Promise<void>`** — factory that returns a yield function bound to the detected strategy. The returned function MUST:
   - `scheduler.yield` strategy: call `scheduler.yield()` directly. This preserves task priority (user-visible work resumes before background work).
   - `MessageChannel` strategy: create ONE channel at factory time (not per-yield). Post a message, resolve the promise in the `onmessage` handler. This yields to the macrotask queue, giving the browser a chance to paint.
   - `setTimeout` strategy: `setTimeout(resolve, 0)`. Subject to 4ms clamping after 5 nested calls — acceptable as last resort.
   - The factory is called ONCE. The channel/timer is reused. No allocation per yield.

2. **`wrapWithScheduler(handler: Function, threshold: number, yielder: () => Promise<void>, debug: DebugFn): Function`** — wraps a handler to auto-yield. The wrapper MUST:
   - Return a NEW function (never mutate the original).
   - Preserve `this` binding via `.apply(this, arguments)` (not arrow function capture).
   - Preserve `arguments` exactly (including `Event` object).
   - Measure elapsed time with `performance.now()` BEFORE and AFTER calling the original handler.
   - If the handler is **synchronous** and takes >threshold: the damage is already done for THIS interaction (you can't yield mid-synchronous execution). Log a debug warning with the elapsed time and suggest wrapping with `yieldToMain()`. Do NOT try to retroactively fix sync handlers — that's dishonest.
   - If the handler is **async** (returns a Promise): attach a `.then()` continuation that checks elapsed time and auto-yields if needed before the next microtask. This splits long async chains.
   - If the handler **throws**: the error MUST propagate to the caller exactly as if SnapINP weren't installed. Never wrap in try/catch that swallows. Use try/finally for cleanup.
   - If the handler returns a **non-Promise value**: return it untouched.
   - The wrapper's `.length` property should match the original handler's `.length` (use `Object.defineProperty`).

3. **`yieldToMain(): Promise<void>`** — the cooperative yield point. Users call `await yieldToMain()` inside their own async handlers to create explicit yield points. This is the RECOMMENDED path — auto-yielding for sync handlers is fundamentally limited (you can't interrupt synchronous JS). The docs must make this clear.

**CRITICAL DESIGN HONESTY:** Be upfront in docs and code comments that SnapINP cannot magically fix synchronous long tasks. It CAN: (a) detect them and warn, (b) provide `yieldToMain()` for async cooperative yielding, (c) split async handler chains, (d) provide metrics to find the problems. It CANNOT: interrupt a 300ms synchronous `for` loop mid-execution. Any claim otherwise would be technically dishonest.

**`src/interceptor.ts`** — Monkey-patches `addEventListener` / `removeEventListener`. This is the most dangerous module — it modifies browser globals.

Safety requirements:

1. **Double-patch detection:** On init, check for a sentinel: `if ((EventTarget.prototype.addEventListener as any).__snapinp__) { warn('SnapINP already installed'); return; }`. The sentinel is a non-enumerable, non-configurable symbol property on the patched function.

2. **Original preservation:** Before patching, store originals:

   ```typescript
   const originalAddEventListener = EventTarget.prototype.addEventListener;
   const originalRemoveEventListener =
     EventTarget.prototype.removeEventListener;
   ```

   These are stored in module scope (closure), NOT on globalThis or any reachable object.

3. **Handler WeakMap:** `const handlerMap = new WeakMap<Function, WeakMap<EventTarget, Map<string, Function>>>()`. Structure: `originalHandler → target → eventType → wrappedHandler`. This 3-level map is necessary because the same handler function can be registered on different targets for different events. The outer WeakMap keys on the handler function (GC'd when handler is GC'd). The inner WeakMap keys on the EventTarget (GC'd when element is removed from DOM). The innermost Map keys on event type string.

4. **Patched addEventListener:** The replacement function must:
   - Check if `type` is in the interaction events set. If not, call original directly — zero overhead for non-interaction events (scroll, resize, etc.).
   - Check if the target matches any `exclude` selector. If so, call original directly.
   - Check the `adaptive` feedback: if observer reports this event type's INP is already good, call original directly.
   - Otherwise: create a wrapped handler via `wrapWithScheduler()`, store the mapping in the WeakMap, call original with the wrapped handler.
   - Preserve ALL options: `capture`, `once`, `passive`, `signal` (AbortSignal). For `once` handlers: the WeakMap entry must be cleaned up after the first invocation.
   - Handle the case where `listener` is `null` (browsers accept this — it's a no-op).
   - Handle the case where `listener` is an `EventListenerObject` (`{ handleEvent }`) — wrap `handleEvent`, not the object.

5. **Patched removeEventListener:** Look up the original handler in the WeakMap, retrieve the wrapped version, call original `removeEventListener` with the wrapped version. Clean up the WeakMap entry. If not found in WeakMap, call original with the given handler (it might have been registered before SnapINP initialized, or for a non-interaction event).

6. **`restore()` function:** Must:
   - Replace patched methods with stored originals via `Object.defineProperty`.
   - Remove the sentinel symbol.
   - Clear the handler WeakMap (set to a new empty WeakMap — let GC handle the old entries).
   - Be idempotent (calling restore() twice is safe).
   - After restore, any NEW event listeners use the original path. Existing wrapped handlers will still work (they hold a closure reference to the yielder) but new ones won't be wrapped.

7. **Interaction with other libraries:** Other libraries (React, jQuery, analytics scripts) may ALSO monkey-patch addEventListener. SnapINP's approach:
   - On patch: save whatever is CURRENTLY on the prototype (which may already be patched by something else). This means SnapINP's wrapper calls through to whatever was there before, preserving the chain.
   - On restore: put back exactly what was saved. If another library patched AFTER SnapINP, restoring will break that library's patch. This is documented as a known limitation with a recommendation: initialize SnapINP LAST, or use `wrap()` manual mode instead of auto-patching.
   - Document this in ARCHITECTURE.md with a "Monkey-Patching Order" section.

**`src/observer.ts`** — INP measurement via PerformanceObserver.

Specification:

1. **Entry processing:** Observe `{ type: 'event', buffered: true, durationThreshold: 16 }`. For each `PerformanceEventTiming` entry:
   - Extract: `name` (event type), `startTime`, `processingStart`, `processingEnd`, `duration`, `interactionId`, `target`.
   - Compute: `inputDelay = processingStart - startTime`, `processingTime = processingEnd - processingStart`, `presentationDelay = duration - (processingEnd - startTime)`.
   - Group by `interactionId` (one interaction may fire multiple events — e.g., pointerdown + pointerup + click). Take the LONGEST duration within each interaction group. This matches Chrome's INP algorithm.
   - Generate a CSS selector for the target (via `generateSelector`). Handle case where `target` is null (happens for events on removed elements).

2. **INP calculation:** Chrome defines INP as: take the worst interaction per page load, then if there are ≥50 interactions, take the p98 (exclude the top 2%). For simplicity and to match `web-vitals` library behavior: take the interaction with the highest duration, but if there are ≥50, drop the single worst and take the next-worst. Store interactions in a sorted bounded array (max 200 entries, sorted by duration descending). INP = `interactions[Math.min(interactions.length - 1, Math.floor(interactions.length / 50))]`.

3. **Rating:** `good` = INP ≤ 200ms, `needs-improvement` = 200-500ms, `poor` = >500ms. Matches Google's thresholds.

4. **Feedback callback:** Accepts an optional `onFeedback: (eventType: string, rating: 'good' | 'needs-improvement' | 'poor') => void` callback that the interceptor uses for adaptive mode. This is NOT a direct import — it's dependency-injected.

5. **Graceful degradation:** If `PerformanceObserver` is unavailable or doesn't support `event` type: log a structured warning via debug(), return a no-op observer that reports empty metrics. Never throw.

6. **`long-animation-frame` support:** If the browser supports LoAF entries (`{ type: 'long-animation-frame' }`), observe them as supplementary data. LoAF gives script attribution — which specific script caused the long task. Include this in debug output when available. Do NOT require it.

**`src/reporter.ts`** — Metrics aggregation and export.

Specification:

1. **Baseline tracking:** For the first N seconds after `snap()` is called (default: 5), record the INP as `baseline`. After the baseline window, every subsequent INP reading computes `delta = baseline - current`. Positive delta = improvement.

2. **`report()` function:** Returns a frozen `INPReport` object. All fields are readonly. The report is a snapshot — calling it twice returns independent objects.

3. **Beacon support:** `report({ beacon: '/api/vitals' })` registers a `visibilitychange` listener that calls `navigator.sendBeacon(url, JSON.stringify(report()))` when the page is hidden. Uses `{ type: 'application/json' }` Blob. The listener is registered ONCE, not per-call. Respects `keepalive`.

4. **Histogram:** Groups slow interactions (>200ms) by event type. E.g., `{ 'click': 12, 'keydown': 3 }`. Useful for identifying which event types are the main offenders.

5. **`web-vitals` compatibility:** The output format should be trivially mappable to Google's `web-vitals` library format. Document the mapping in ARCHITECTURE.md.

---

### 3. Public API Contract (`src/index.ts`)

```typescript
// ── Auto mode ─────────────────────────────────────
export function snap(options?: SnapOptions): Disposable;

// ── Manual mode ───────────────────────────────────
export function wrap<T extends (...args: any[]) => any>(
  fn: T,
  options?: WrapOptions,
): T;
export function yieldToMain(): Promise<void>;

// ── Observe only ──────────────────────────────────
export function observe(callback: (metric: INPMetric) => void): Disposable;

// ── Reporting ─────────────────────────────────────
export function report(options?: {
  beacon?: string;
  onMetric?: (m: INPMetric) => void;
}): INPReport;

// ── Types (re-exported) ───────────────────────────
export type { SnapOptions, WrapOptions, INPMetric, INPReport, Disposable };
```

**API stability guarantees:**

- Every export is a public API contract covered by semver.
- Removing or renaming any export is a MAJOR version bump.
- Adding optional fields to option objects is a MINOR bump.
- Internal modules (`scheduler`, `interceptor`, `observer`, `reporter`) are NOT re-exported. Users cannot import from `snapinp/scheduler`. This gives us freedom to refactor internals.
- The `types.ts` interfaces are the canonical contract. If code and types disagree, the types are correct and code must be fixed.

**SSR / Node.js safety:**

- Every exported function MUST check `isBrowserEnvironment()` first.
- In non-browser environments: `snap()` returns `{ restore: () => {} }` (no-op disposable), `observe()` returns `{ disconnect: () => {} }`, `report()` returns a zeroed-out report, `wrap()` returns the original function untouched, `yieldToMain()` resolves immediately.
- No `window`, `document`, or `navigator` access at module scope. All access is inside function bodies.
- This means the library can be safely imported in Next.js, Nuxt, Remix, Astro, etc. without SSR crashes.

---

### 4. Security Model

**Threat surface:** SnapINP modifies `EventTarget.prototype` — one of the most security-sensitive globals in the browser. It intercepts every interaction event on the page. It must be treated with the same rigor as a browser extension.

**Mandatory security rules:**

1. **No eval, no Function constructor, no dynamic code execution** — ever, under any circumstance, regardless of input.

2. **No prototype pollution vectors:**
   - All option objects are validated against an explicit allowlist of keys. Unknown keys trigger a warning (not an error — forward-compat).
   - Never iterate option objects with `for...in`. Use `Object.keys()` or explicit property access.
   - The handler WeakMap uses `WeakMap.prototype.get/set/has/delete` stored at init time (defense against prototype pollution of WeakMap itself):
     ```typescript
     const wmGet = WeakMap.prototype.get;
     const wmSet = WeakMap.prototype.set;
     const wmHas = WeakMap.prototype.has;
     const wmDel = WeakMap.prototype.delete;
     ```
   - Similarly, store `Map.prototype.get/set/has/delete` at init.

3. **CSP compatibility:** Library works under the strictest CSP: `script-src 'self'; style-src 'self'`. No inline anything. No eval. No dynamic imports. The demo page may use `'unsafe-inline'` for convenience, but the library itself MUST NOT require it.

4. **Event data isolation:** The observer reads `PerformanceEventTiming` entries. It extracts ONLY: numeric timing fields, event type string, and a generated CSS selector. It NEVER reads event payload data (e.g., `KeyboardEvent.key`, `InputEvent.data`). It NEVER stores references to Event objects (they would prevent GC of the entire event dispatch chain). It NEVER stores references to DOM elements (only the generated selector string).

5. **Beacon data minimization:** The `report({ beacon })` payload contains ONLY aggregated metrics (numbers and strings). No PII, no DOM content, no user input, no event payloads. Document the exact beacon schema in SECURITY.md.

6. **Sandboxed patching with sentinel:**
   - The sentinel on patched addEventListener is a `Symbol('__snapinp__')` — not a string property. Symbols don't appear in `for...in`, `Object.keys()`, or `JSON.stringify()`.
   - The sentinel is non-enumerable, non-writable, non-configurable.
   - `restore()` removes the sentinel via `delete` (possible because we use `configurable: true` ONLY on the sentinel's own descriptor — NOT on the addEventListener property descriptor).

7. **Double-load safety:** If SnapINP detects it's already loaded (sentinel exists), it:
   - Logs a structured warning with both instances' version numbers (version is baked in at build time as a const).
   - Returns a no-op disposable from `snap()`. Does NOT double-patch.
   - The `wrap()` and `observe()` and `yieldToMain()` functions still work — they don't depend on the interceptor.

8. **Supply chain policy:** Zero runtime dependencies. Dev dependencies (tsup, vitest, eslint, prettier, size-limit, changesets) are pinned to exact versions in `package.json`. Lockfile is committed. CI runs `npm audit` on every build.

---

### 5. Performance Engineering

**Overhead budget:**

| Path                                        | Budget                          | How                                                              |
| ------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| Non-interaction event listener registration | 0 overhead                      | Early return before any wrapping logic                           |
| Interaction event registration (patched)    | <0.05ms                         | One WeakMap lookup + one function creation                       |
| Event handler invocation (no yield needed)  | <0.01ms                         | Two `performance.now()` calls + one subtraction + one comparison |
| Event handler invocation (yield triggered)  | <0.1ms overhead on top of yield | One promise creation + one MessageChannel post                   |
| `observe()` only (no interceptor)           | 0 main-thread overhead          | PerformanceObserver runs off main thread                         |
| Module import (SSR/Node)                    | <0.05ms                         | Feature detection + early return                                 |

**Mandatory performance rules:**

1. **No allocation on the hot path.** The wrapped handler's fast path (handler runs, threshold not exceeded) must not create objects, arrays, closures, or strings. The only permitted allocations are the two `performance.now()` number returns.

2. **No closures capturing large scopes.** Every closure must be reviewed to ensure it captures only the variables it needs. Especially: the wrapped handler must NOT capture the `options` object — extract needed values (threshold number, debug flag) into local variables at wrap time.

3. **Bounded data structures.** The observer's interaction buffer is a fixed-size circular buffer (max 200 entries). When full, the oldest entry is overwritten. The histogram in reporter is bounded to the set of known interaction event types (9 types max). No unbounded growth anywhere.

4. **No layout-triggering reads.** The library NEVER calls: `getBoundingClientRect`, `offsetHeight`, `offsetWidth`, `clientHeight`, `clientWidth`, `scrollHeight`, `scrollWidth`, `getComputedStyle`, `innerText`, or ANY other property that forces synchronous layout. The `generateSelector` utility reads ONLY: `tagName`, `id`, `className` (all of which are cached on the element and don't trigger reflow).

5. **Passive listener hints.** When SnapINP's patched `addEventListener` wraps a handler for `touchstart` or `touchmove`, it adds `{ passive: true }` to the options unless the original call explicitly set `passive: false`. This avoids the "non-passive touchstart" warning and improves scroll performance.

6. **Deferred initialization.** The `PerformanceObserver` in `observer.ts` is created lazily — only when `observe()` or `snap({ adaptive: true })` is first called. Importing the library does ZERO work.

7. **Tree-shaking verification.** The CI must include a build step that imports ONLY `{ observe }` and verifies (via size-limit) that the output does NOT contain any code from `interceptor.ts` or `scheduler.ts`. Similarly, `{ yieldToMain }` must not pull in observer.

---

### 6. Framework Compatibility

SnapINP operates at the `EventTarget.prototype` level, which sits BELOW framework event systems. Document these interactions:

**React (v16-19):** React uses a single delegated event listener on the root. SnapINP's patch catches this root listener. Since React batches state updates synchronously, yielding inside a React event handler can cause state tearing if not done carefully. **Recommendation:** For React apps, prefer `yieldToMain()` inside `startTransition()` or use `wrap()` on specific callbacks rather than `snap()` auto-mode. Document this with a code example.

**Vue (v3):** Vue attaches handlers directly to elements (no delegation). SnapINP auto-mode works well with Vue. `v-on` modifiers like `.prevent` and `.stop` are applied before SnapINP's wrapper sees the handler. No known issues.

**Svelte:** Svelte compiles handlers to direct `addEventListener` calls. SnapINP auto-mode works transparently. No known issues.

**Angular:** Angular uses Zone.js which patches `addEventListener`. If Zone.js loads BEFORE SnapINP, SnapINP wraps Zone's patched version (works fine). If SnapINP loads BEFORE Zone.js, Zone.js overwrites SnapINP's patch. **Recommendation:** Load SnapINP AFTER Angular bootstraps. Document this.

**jQuery:** jQuery uses its own event delegation. SnapINP's patch catches jQuery's internal `addEventListener` calls. Works transparently. No known issues.

**Web Components / Shadow DOM:** Events inside shadow DOM still go through `addEventListener` on the shadow host. SnapINP's patch catches these. The `generateSelector` utility must handle shadow roots gracefully (stop at the shadow boundary, don't try to pierce it).

**Document this entire matrix in a `FRAMEWORK_COMPAT.md`** file with code examples for each framework.

---

### 7. Error Handling Philosophy

SnapINP follows these error principles:

1. **User errors throw immediately.** Invalid options (wrong types, negative threshold) throw `TypeError` with a descriptive message and the invalid value. These are programmer mistakes — fail fast.

2. **Runtime environment issues degrade gracefully.** Missing `PerformanceObserver`, missing `scheduler.yield`, running in Node.js — these log a debug-level warning and fall back to reduced functionality. They never throw.

3. **Handler errors propagate exactly.** If the user's event handler throws, the error must reach the browser's error handler exactly as it would without SnapINP. No wrapping in a new Error. No adding stack frames. No catching and re-throwing (which resets the stack). Use `try { ... } finally { cleanup() }` — never `try { ... } catch (e) { ...; throw e }`.

4. **Internal errors are contained.** If SnapINP's own code throws (a bug), it must NOT crash the user's page. Wrap internal logic (not user handlers) in try/catch, log to console.error with `[SnapINP internal error]` prefix, and degrade to pass-through mode. The handler still runs — just without yielding.

5. **Error types:** Define a `SnapINPError` class extending `Error` with a `code` property for programmatic matching: `INVALID_OPTIONS`, `ALREADY_INITIALIZED`, `OBSERVER_UNSUPPORTED`, `INTERNAL_ERROR`. Only used for errors SnapINP itself throws — never wraps user errors.

---

### 8. Testing Strategy

**Test categories (all in `test/` directory):**

1. **Unit tests** (`*.test.ts`) — test each module in isolation with mocked dependencies. Scheduler tests mock `performance.now()` and `MessageChannel`. Observer tests mock `PerformanceObserver`. Interceptor tests mock `EventTarget.prototype`.

2. **Integration tests** (`integration.test.ts`) — test `snap()` end-to-end with real DOM events in jsdom/happy-dom. Fire a click, verify the handler runs, verify the wrapper yields (by checking that a microtask ran between chunks).

3. **Security tests** (`security.test.ts`) — test for:
   - Prototype pollution: pass `{ __proto__: { polluted: true } }` as options, verify `Object.prototype.polluted` is undefined.
   - Double-load: call `snap()` twice, verify warning and single-patch.
   - Handler error propagation: throw inside a handler, verify error reaches the top.
   - WeakMap GC: register handlers, remove elements from DOM, verify WeakMap doesn't leak (use `FinalizationRegistry` if available in test env).
   - Option validation: every invalid input type for every option.

4. **Performance tests** (`benchmarks/`) — NOT in the regular test suite. Separate benchmark scripts that:
   - Measure wrapper overhead per interaction (target: <0.01ms).
   - Measure memory growth over 10K interactions (target: <1MB).
   - Measure import time (target: <2ms).
   - Run in actual browsers via Playwright, not jsdom.

5. **Compatibility tests** (`compat/`) — Playwright test suite that runs the demo page in Chrome, Firefox, Safari (WebKit). Verifies:
   - `snap()` patches and restores cleanly.
   - INP metrics are reported (Chrome only — Firefox/Safari don't expose `interactionId`).
   - No console errors in any browser.
   - Graceful degradation where APIs are missing.

**Coverage target:** >95% line coverage for `src/`. 100% branch coverage for `utils.ts` (it's all validation — every branch matters). Coverage is enforced in CI.

---

### 9. Build & Tooling

- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noPropertyAccessFromIndexSignature: true`. No `any` — use `unknown` and narrow.
- **Build:** `tsup` — produces `dist/index.mjs` (ESM), `dist/index.cjs` (CJS), `dist/index.global.js` (IIFE, `globalThis.SnapINP`). Source maps for all three. `package.json` exports map configured correctly.
- **Test:** `vitest` with `happy-dom` environment. `@testing-library/dom` for integration tests.
- **Lint:** `eslint` + `@typescript-eslint/strict-type-checked`. Custom rule: disallow `any` type (error, not warning).
- **Format:** `prettier` with enforced config.
- **Size:** `size-limit` in CI. Fail if ESM > 3KB gzip or observe-only import > 1KB gzip.
- **CI:** GitHub Actions:
  - `ci.yml`: lint → typecheck → test (with coverage) → build → size check → npm audit. Runs on every push and PR.
  - `publish.yml`: triggered on release tag creation. Runs full CI, then `npm publish --provenance` (npm provenance for supply chain transparency).
- **Versioning:** `changesets` for managing version bumps and changelogs.

---

### 10. Documentation

**`README.md`** must include:

- Badges (npm version, bundle size, CI status, TypeScript, license)
- One-sentence description + one-line install + one-line usage
- "How it works" section (30-second read, non-technical)
- "API Reference" section (every export with types and examples)
- "Framework guides" section (React, Vue, Svelte, Angular, vanilla)
- "Browser support" table
- "Honest limitations" section (can't fix sync handlers, overhead budget, monkey-patching caveats)
- "Comparison with alternatives" (web-vitals, INP polyfill, manual scheduling)
- "Contributing" link to CONTRIBUTING.md

**`docs/ARCHITECTURE.md`** — everything in section 2 above, expanded with diagrams and rationale.

**`docs/SECURITY.md`** — everything in section 4, plus:

- Threat model (what if a malicious script overwrites our WeakMap methods? what if someone passes a Proxy as options?)
- Beacon data schema (exact JSON structure)
- Responsible disclosure process

**`docs/FRAMEWORK_COMPAT.md`** — everything in section 6 with copy-paste code examples.

**`docs/CONTRIBUTING.md`** — setup instructions, PR checklist, coding conventions, test requirements.

---

### 11. Coding Conventions (enforce in CLAUDE.md)

- All code must pass `tsc --noEmit` with zero errors and zero warnings.
- All public functions need JSDoc with `@param`, `@returns`, `@example`, `@throws`.
- No `console.log` in source code. Use the `createDebugger` utility (tree-shaken in prod).
- All timing uses `performance.now()` via the `now()` utility (SSR-safe).
- All browser API access is guarded by feature detection. No bare `window.X` at module scope.
- Test files mirror source: `src/X.ts` → `test/X.test.ts`.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `perf:`, `security:`, `docs:`, `test:`, `chore:`).
- Inline browser compat notes: `// Chrome 129+: scheduler.yield()`.
- No default exports. Named exports only.
- No enums. Use `as const` objects or union types.
- No classes (except `SnapINPError`). Use plain functions and closures.
- Prefer `readonly` and `Readonly<T>` for all data that shouldn't be mutated.
- Max function length: 40 lines. If longer, decompose.
- Max file length: 300 lines (excluding tests). If longer, the module has too many responsibilities.

---

### 12. Versioning & Deprecation Policy (document in CLAUDE.md)

- Follow semver strictly. Breaking change = major bump, always.
- Deprecations: mark with `@deprecated` JSDoc tag + console.warn on first call. Deprecated APIs are removed in the NEXT major version, never sooner.
- Minimum deprecation window: 3 months or 1 major version, whichever is longer.
- Changelog generated by changesets. Every merged PR must have a changeset file.

---

## Step 2: Generate the Full Project

After generating `CLAUDE.md`, scaffold the complete project with all files from the structure in section 2. Write **real, production-quality, fully working implementation code** for every module. Not stubs. Not TODOs. Not simplified versions.

The code should:

- Work end-to-end: `snap()` genuinely patches handlers, yields via the detected strategy, observes INP, and reports metrics.
- Handle every edge case documented above (EventListenerObject, once handlers, shadow DOM selectors, AbortSignal, null listeners, async handlers, throwing handlers, SSR no-ops, double-load).
- Have comprehensive tests covering all of the above.
- Include the split-screen demo page showing a 10K-row table filter with vs. without SnapINP.
- Include a polished README ready for the launch tweet.

---

## Step 3: Verify

After generating everything, run these checks and fix any issues:

1. `npx tsc --noEmit` — zero errors
2. `npx vitest run --coverage` — all tests pass, >95% coverage
3. `npx tsup` — builds all three formats, no warnings
4. `npx size-limit` — ESM < 3KB gzip
5. `npx eslint src/` — zero errors
6. Manually verify: `import { observe } from './src/index'` tree-shakes without pulling in interceptor/scheduler (check the tsup output)
7. Manually verify: all public functions return correctly in a Node.js environment (no crashes)

Do not finish until all 7 checks pass.
