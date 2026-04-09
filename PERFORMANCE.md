## ⚡ Core Performance Goals

- <3KB gzipped bundle
- <1KB observe-only
- Zero runtime allocations in hot path

---

## 🔥 Hot Path Rules

### Event Handler Wrapping

Allowed:

- 2 × `performance.now()`

Forbidden:

- Object allocation
- Array creation
- Closures capturing large scope

---

## 🧠 Memory Constraints

- Observer buffer ≤ 200 entries
- Histogram ≤ 9 event types
- No unbounded growth

---

## 🚫 Layout Thrashing

Never call:

- `getBoundingClientRect`
- `offsetHeight`
- `getComputedStyle`

---

## 📱 Event Optimization

- Use passive listeners for:

  - touchstart
  - touchmove

---

## ⏱️ Initialization

- Lazy-load PerformanceObserver
- No work at module load

---

## 🌳 Tree-Shaking

- Must support:

  ```ts
  import { observe } from "snapinp";
  ```

- Verified in CI

---

## 🧪 Performance Testing

### Benchmarks Must Cover:

- Handler overhead
- Memory usage
- Observer impact

---

## ✅ Performance Checklist

- [ ] No hot-path allocations
- [ ] No layout reads
- [ ] Bounded memory
- [ ] Lazy initialization
- [ ] Tree-shakeable
- [ ] Under size budget
