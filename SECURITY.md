## 🔐 Security Principles

### 1. No Dynamic Execution

- No `eval`
- No `new Function`
- No runtime code generation

---

### 2. Prototype Safety

- Validate all options via allowlist
- Store Map/WeakMap methods at init time
- Never trust user input

---

### 3. CSP Compatibility

- Must work under:

  ```
  script-src 'self'; style-src 'self'
  ```

---

### 4. Data Isolation

#### Allowed:

- Timing metrics
- Derived selectors

#### Forbidden:

- Event payloads
- DOM references
- User data

---

### 5. Data Minimization

- Only aggregated metrics
- No PII ever

---

### 6. Sentinel Protection

- Use `Symbol`
- Non-enumerable
- Non-writable

---

### 7. Double Initialization

- Detect duplicate load
- Warn once
- Return no-op

---

### 8. Dependencies

- Zero runtime dependencies
- Dev dependencies pinned exactly

---

## 🚫 Forbidden Patterns

- Accessing raw event data
- Storing DOM nodes
- Using global mutable state
- Implicit type coercion in validation

---

## ✅ Security Checklist

- [ ] No dynamic execution
- [ ] Options validated
- [ ] No DOM retention
- [ ] No PII collected
- [ ] CSP safe
- [ ] Double-load safe
