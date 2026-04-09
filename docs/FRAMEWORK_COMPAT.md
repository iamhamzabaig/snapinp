# Framework Compatibility

SnapINP operates at the `EventTarget.prototype` level, below all framework event systems.

## React (v16–19)

React uses a single delegated event listener on the root container. SnapINP's patch catches this root listener.

**Caveat:** React batches state updates synchronously. Yielding inside a React event handler can cause state tearing if not done carefully.

**Recommended approach — use `yieldToMain()` with `startTransition()`:**

```tsx
import { yieldToMain } from "snapinp";
import { startTransition, useState } from "react";

function SearchBar() {
  const [results, setResults] = useState([]);

  const handleInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    await yieldToMain(); // Let browser paint the input change
    startTransition(() => {
      setResults(search(query)); // Non-urgent update
    });
  };

  return <input onChange={handleInput} />;
}
```

**Alternative — use `wrap()` on specific callbacks:**

```tsx
import { wrap } from "snapinp";

const optimizedHandler = wrap(expensiveCallback, { threshold: 30 });
<button onClick={optimizedHandler}>Process</button>
```

**Not recommended for React:** `snap()` auto-mode. While it works, the interaction between automatic yielding and React's synchronous batching can be unpredictable.

## Vue (v3)

Vue attaches handlers directly to elements via `v-on`. No event delegation. SnapINP auto-mode works well.

```typescript
// main.ts
import { snap } from "snapinp";

const app = createApp(App);
app.mount("#app");
snap(); // Call after mount
```

```vue
<template>
  <button @click="handleClick">Process</button>
</template>

<script setup lang="ts">
function handleClick() {
  // This handler is automatically wrapped by SnapINP
  doExpensiveWork();
}
</script>
```

`v-on` modifiers (`.prevent`, `.stop`, `.once`) are applied at compile time, before SnapINP's wrapper sees the handler. No interference.

## Svelte

Svelte compiles event handlers to direct `addEventListener` calls. Auto-mode works transparently.

```typescript
// +layout.ts
import { snap } from "snapinp";
import { browser } from "$app/environment";

if (browser) {
  snap();
}
```

```svelte
<button on:click={handleClick}>Process</button>

<script>
  function handleClick() {
    // Automatically wrapped by SnapINP
    doExpensiveWork();
  }
</script>
```

## Angular

Angular uses Zone.js, which also patches `addEventListener`. Load order matters.

**If Zone.js loads BEFORE SnapINP** (normal case): SnapINP wraps Zone's patched version. Works fine.

**If SnapINP loads BEFORE Zone.js**: Zone.js overwrites SnapINP's patch. SnapINP is silently disabled.

**Recommended: load SnapINP after Angular bootstraps:**

```typescript
// main.ts
platformBrowserDynamic().bootstrapModule(AppModule).then(() => {
  import("snapinp").then(({ snap }) => snap());
});
```

Or use manual mode to avoid load-order issues entirely:

```typescript
import { wrap, yieldToMain } from "snapinp";

@Component({ ... })
export class MyComponent {
  async handleClick() {
    quickUIUpdate();
    await yieldToMain();
    expensiveWork();
  }
}
```

## jQuery

jQuery uses its own event delegation internally, but it calls `addEventListener` under the hood. SnapINP's patch catches these calls transparently.

```html
<script src="jquery.min.js"></script>
<script src="snapinp/dist/index.global.js"></script>
<script>
  SnapINP.snap();

  // jQuery handlers are automatically optimized
  $("button").on("click", function () {
    doExpensiveWork();
  });
</script>
```

## Web Components / Shadow DOM

Events inside Shadow DOM still go through `addEventListener` on the shadow host. SnapINP's patch catches these.

The `generateSelector()` utility handles shadow roots gracefully — it stops at the shadow boundary and does not attempt to pierce it.

```javascript
class MyElement extends HTMLElement {
  connectedCallback() {
    const shadow = this.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    // This addEventListener call is intercepted by SnapINP
    btn.addEventListener("click", () => doWork());
    shadow.appendChild(btn);
  }
}
```

## Compatibility Matrix

| Framework      | Auto mode (`snap()`) | Manual mode (`wrap()`) | `yieldToMain()` | Known Issues                     |
| -------------- | -------------------- | ---------------------- | --------------- | -------------------------------- |
| React 16–19    | Caution              | Recommended            | Recommended     | State tearing with auto-yield    |
| Vue 3          | Works well           | Works                  | Works           | None                             |
| Svelte         | Works well           | Works                  | Works           | None                             |
| Angular        | Load order matters   | Recommended            | Recommended     | Zone.js conflict if loaded first |
| jQuery         | Works well           | Works                  | Works           | None                             |
| Web Components | Works well           | Works                  | Works           | Selector stops at shadow root    |
| Vanilla JS     | Works well           | Works                  | Works           | None                             |
