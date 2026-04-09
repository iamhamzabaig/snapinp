# Security

## Threat Model

SnapINP modifies `EventTarget.prototype` — one of the most security-sensitive globals in the browser. It intercepts every interaction event on the page.

### Attack Surface

1. **Prototype pollution via options:** An attacker passes `{ __proto__: { polluted: true } }` as options.
   - **Mitigation:** Options are validated against an explicit allowlist. Unknown keys trigger a warning. `for...in` is never used on options — only `Object.keys()`.

2. **Prototype pollution of WeakMap/Map:** An attacker overrides `WeakMap.prototype.get` before SnapINP loads.
   - **Mitigation:** WeakMap and Map methods are captured at module init time:
     ```typescript
     const wmGet = WeakMap.prototype.get;
     const wmSet = WeakMap.prototype.set;
     // ...
     ```

3. **Proxy-based options:** An attacker passes a `Proxy` as options that intercepts property access.
   - **Mitigation:** Options are validated and destructured immediately. No ongoing reference is held. Extracted values (threshold number, debug boolean) are primitives that can't be Proxied.

4. **Double-load:** SnapINP is loaded twice (e.g., different bundle chunks).
   - **Mitigation:** Symbol sentinel on patched `addEventListener`. Second `snap()` detects sentinel, warns, returns no-op.

5. **Event data exfiltration:** SnapINP reads event payloads and leaks them via beacon.
   - **Mitigation:** Observer reads ONLY `PerformanceEventTiming` fields (numeric timing, event type string). It NEVER reads `Event.key`, `InputEvent.data`, or any payload. It NEVER stores Event object references.

6. **DOM reference leaks:** Stored DOM references prevent garbage collection.
   - **Mitigation:** Only CSS selector strings are stored (via `generateSelector()`). Element references are not retained. The handler WeakMap keys on `EventTarget` — entries are GC'd when elements are removed.

## Beacon Data Schema

The `report({ beacon })` payload contains ONLY:

```json
{
  "inp": 150,
  "p75": 120,
  "p99": 300,
  "improved": true,
  "delta": 50,
  "interactions": 42,
  "slowest": {
    "inp": 300,
    "eventType": "click",
    "target": "button#submit.primary",
    "processingTime": 250,
    "inputDelay": 20,
    "presentationDelay": 30,
    "timestamp": 1234567.89,
    "id": "12345-1234567"
  },
  "histogram": {
    "click": 5,
    "keydown": 2
  },
  "rating": "good"
}
```

**No PII. No DOM content. No user input. No event payloads.**

The `target` field is a generated CSS selector (tag, id, class names only) — it does not contain text content or attribute values.

## CSP Compatibility

SnapINP works under the strictest Content Security Policy:

```
Content-Security-Policy: script-src 'self'; style-src 'self'
```

The library:
- Never uses `eval()` or `new Function()`
- Never creates inline scripts or styles
- Never uses dynamic `import()`
- Never requires `unsafe-inline` or `unsafe-eval`

## Supply Chain

- Zero runtime dependencies
- Dev dependencies pinned to exact versions
- `package-lock.json` committed
- CI runs `npm audit` on every build
- Published with `--provenance` for npm supply chain transparency

## Responsible Disclosure

If you discover a security vulnerability in SnapINP, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email security concerns to the maintainers (see package.json)
3. Include a description, reproduction steps, and potential impact
4. Allow 90 days for a fix before public disclosure
