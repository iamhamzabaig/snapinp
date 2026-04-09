# Contributing to SnapINP

## Setup

```bash
git clone https://github.com/user/snapinp.git
cd snapinp
npm install
```

## Development Commands

```bash
npm run build          # Build ESM, CJS, IIFE
npm run typecheck      # TypeScript strict check
npm test               # Run tests
npm run test:watch     # Watch mode
npm run test:coverage  # Tests with coverage report
npm run lint           # ESLint
npm run format         # Prettier
npm run size           # Bundle size check
npm run ci             # Full CI pipeline locally
```

## PR Checklist

- [ ] All tests pass (`npm test`)
- [ ] TypeScript compiles with zero errors (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Bundle size within budget (`npm run size`)
- [ ] Changeset file added (`npx changeset`)
- [ ] New public APIs have JSDoc with `@param`, `@returns`, `@example`
- [ ] Tests added for new functionality
- [ ] No `any` types — use `unknown` and narrow
- [ ] No `console.log` — use `createDebugger`

## Coding Conventions

- **No default exports.** Named exports only.
- **No enums.** Use `as const` objects or union types.
- **No classes** (except `SnapINPError`). Plain functions and closures.
- **`readonly` everywhere.** Use `Readonly<T>` for data that shouldn't mutate.
- **Max 40 lines per function.** Decompose if longer.
- **Max 300 lines per file** (excluding tests).
- **Test files mirror source:** `src/X.ts` → `test/X.test.ts`.
- **Conventional Commits:** `feat:`, `fix:`, `perf:`, `security:`, `docs:`, `test:`, `chore:`.

## Architecture Rules

- `types.ts` and `utils.ts` are leaf modules — no project imports.
- `observer.ts` never imports from `interceptor.ts` or `scheduler.ts`.
- No browser API access at module scope.
- All timing via `now()` utility (SSR-safe).
- All debug logging via `createDebugger()` (tree-shaken in prod).

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add support for AbortSignal in addEventListener options
fix: prevent double-wrap when handler is registered twice
perf: reduce WeakMap lookups in hot path
security: validate options against allowlist to prevent prototype pollution
docs: add Angular load-order guide
test: add security tests for prototype pollution
chore: update tsup to 8.3.5
```

## Changesets

Every PR that changes behavior needs a changeset:

```bash
npx changeset
```

Select the package, choose the semver bump level, and write a summary.
