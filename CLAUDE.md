# Up-to-date documentation

Propose updating this CLAUDE.md with any information that will make any future queries, research, planning and/or implementation faster to perform.

# currentDate
Today's date is 2026-03-10.

# Project overview

GHD (GitHub Notification Dashboard) — a native macOS desktop app built with Electrobun + Bun + SQLite.

## Key tech stack
- **Runtime**: Bun
- **Desktop framework**: Electrobun (v1.15.1) — ships raw .ts files, NOT compiled .d.ts
- **Database**: bun:sqlite (WAL mode, foreign keys ON)
- **Linting/Formatting**: Biome (v2.4.6)
- **Type checking**: TypeScript (v5.9.3) with strict mode
- **Git hooks**: Lefthook

## Verification commands
```bash
bun run check        # biome format + lint
bun run typecheck    # tsc --noEmit (filtered to exclude node_modules errors)
bun test             # unit + integration tests
bun run dev          # launches Electrobun window
```

## Known quirks
- **Electrobun ships raw .ts source** — `skipLibCheck` doesn't help since it only applies to .d.ts files. The `scripts/typecheck.sh` wrapper filters out node_modules errors from tsc output.
- **`noPropertyAccessFromIndexSignature`** conflicts with biome's `useLiteralKeys` — biome rule is turned off; bracket notation is required for index signatures (e.g., `process.env["HOME"]`, `dataset["tab"]`).
- **`exactOptionalPropertyTypes: true`** in tsconfig — electrobun's source isn't compatible, but the typecheck filter handles this.

## Project structure
```
src/bun/index.ts          — Main process (Electrobun BrowserWindow + DB init)
src/mainview/             — WebView HTML/CSS/TS
src/shared/rpc.ts         — RPC type definitions
src/db/client.ts          — Database factory (createDatabase, createMemoryDatabase)
src/db/migrations.ts      — Versioned migration runner
src/db/schema.ts          — SQL migration definitions (append-only)
src/db/types.ts           — Row types + branded ID types
tests/db/                 — Migration and query tests
scripts/typecheck.sh      — tsc wrapper filtering node_modules errors
```

## Electrobun imports
- Bun process: `import { BrowserWindow, ... } from "electrobun"` (or `"electrobun/bun"`)
- WebView: `import { ... } from "electrobun/view"`
- Key types: `ElectrobunConfig`, `ElectrobunRPCSchema`, `RPCSchema`, `WindowOptionsType`, `BrowserViewOptions`

# Testing strategy

After every code change, always run:

1. Formatter
2. Linter (strictest mode)
3. Type checker (strictest mode)
4. Unit and integration tests

Fix any remaining issues that the linter cannot auto-resolve.

Any new functionality or code change must be covered by unit and integration tests.

When fixing a bug or issue, consider adding unit or integration tests that would have prevented the issue in the first place.
