## 🧠 Project Overview

**Name:** SnapINP
**Tagline:** One line. Instant UI. Every interaction.

**Mission:**
Automatically improve Interaction to Next Paint (INP) by intercepting event handlers and yielding to the browser between work chunks.

**Non-goals:**

- Not a task scheduler
- Not a framework
- Not a polyfill for `scheduler.yield()`

**Constraints:**

- <3KB gzipped total
- <1KB observe-only path
- Zero dependencies
- TypeScript-first
- Ships: ESM + CJS + IIFE

**Environment:**

- Browsers: Chrome 90+, Firefox 95+, Safari 15.4+, Edge 90+
- Node/SSR/Web Workers: graceful no-op

**License:** MIT

---

## 🏗️ Architecture

### Module Graph (No Circular Imports)

```
index.ts (public API)
  ├── interceptor.ts → scheduler.ts, utils.ts, types.ts
  ├── scheduler.ts   → utils.ts, types.ts
  ├── observer.ts    → utils.ts, types.ts
  ├── reporter.ts    → observer.ts, utils.ts, types.ts
  ├── types.ts       (leaf)
  └── utils.ts       (leaf)
```

### Rules

- `observer.ts` MUST NOT import:

  - `interceptor.ts`
  - `scheduler.ts`

- Communication must happen via callbacks only
- Enables proper tree-shaking

---

## 📦 Public API

```ts
export function snap(options?: SnapOptions): Disposable;
export function wrap<T extends (...args: any[]) => any>(fn: T, options?: WrapOptions): T;
export function yieldToMain(): Promise<void>;
export function observe(callback: (metric: INPMetric) => void): Disposable;
export function report(options?: { beacon?: string; onMetric?: (m: INPMetric) => void }): INPReport;
export type { SnapOptions, WrapOptions, INPMetric, INPReport, Disposable };
```

---

## 🌍 Environment Safety (SSR / Node)

All exports must guard with `isBrowserEnvironment()`.

### Behavior Outside Browser

- snap → no-op
- observe → no-op
- report → empty
- wrap → identity
- yieldToMain → resolved Promise

### Rules

- No `window`, `document`, `navigator` at module scope

---

## 🔐 Security Model

- No eval or dynamic execution
- No prototype pollution
- CSP compatible
- No event payload access
- No DOM references stored
- Aggregated metrics only
- Symbol sentinel
- Double-load safe
- Zero runtime dependencies

---

## ⚡ Performance Rules

- No allocation on hot path
- Only 2 `performance.now()` calls in handler
- No large closures
- Bounded buffers (≤200)
- No layout reads
- Passive touch listeners
- Lazy initialization
- Tree-shaking verified

---

## ❗ Error Handling

### User Errors

- Throw `TypeError`

### Runtime Issues

- Graceful fallback

### Handler Errors

- Must propagate (no swallowing)

### Internal Errors

- Log and degrade

### Error Codes

- INVALID_OPTIONS
- ALREADY_INITIALIZED
- OBSERVER_UNSUPPORTED
- INTERNAL_ERROR

---

## 🧾 Coding Conventions

- Strict TypeScript
- No console.log
- Named exports only
- No enums
- No classes (except SnapINPError)
- No `any`
- Max function: 40 lines
- Max file: 300 lines

### Testing

```
src/X.ts → test/X.test.ts
```

### Commits

- feat, fix, perf, security, docs, test, chore

---

## 🧠 TypeScript Config

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noPropertyAccessFromIndexSignature": true
}
```

---

## 🛠️ Tooling

- Build: tsup
- Test: vitest
- Lint: eslint
- Format: prettier
- Size: size-limit
- CI: GitHub Actions
- Versioning: changesets

---

## 🔄 Versioning Policy

- SemVer strict
- Breaking = major

### Deprecation

- Mark with @deprecated
- Remove next major or ≥3 months

---

## 📜 API Stability

- All exports are public contract
- Removing = MAJOR
- Adding optional fields = MINOR

**Source of truth: `types.ts`**
