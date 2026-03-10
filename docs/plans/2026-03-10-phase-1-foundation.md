# Phase 1 — Foundation: Implementation Plan

## Overview

Set up the complete project foundation for GHD: Electrobun scaffolding, strict TypeScript configuration, Biome linting, Lefthook git hooks, the SQLite schema with a migration runner, and a hello-world window that creates the database on launch. At the end of this phase the app launches, displays a static page with the tab shell skeleton, and creates a fully-migrated SQLite database on disk.

## Current State Analysis

The repository contains only:
- `CLAUDE.md` — project instructions
- `docs/design.md` — full design document

No code, no config files, no dependencies. Git repo initialized with zero commits.

## Desired End State

1. Running `bun install && bun run dev` launches a native macOS window with a `hiddenInset` titlebar displaying a static HTML page with three tab buttons (Notifications, Pinned, Activity) and placeholder content.
2. On launch, a SQLite database is created at `~/.ghd/ghd.sqlite` with all five tables (`notifications`, `notification_events`, `pinned`, `activity`, `sync_meta`) properly migrated.
3. `bun run check` passes (Biome format + lint + type checking).
4. `bun test` passes with full coverage of the database layer.
5. Git hooks enforce quality on every commit and push.

### Verification:
```bash
bun install
bun run check        # biome format + lint
bun run typecheck    # tsc --noEmit
bun test             # unit + integration tests
bun run dev          # launches window, creates DB
ls ~/.ghd/ghd.sqlite # database file exists
```

## What We're NOT Doing

- No GitHub API client or polling (Phase 2)
- No RPC wiring between Bun and WebView beyond the basic Electrobun scaffold (Phase 3)
- No LLM summarizer (Phase 4)
- No keyboard navigation (Phase 5)
- No IPC server or CLI tool (Phase 6)
- No system tray, app menu, or error handling (Phase 7)
- No real tab switching logic — just the static HTML shell

## Implementation Approach

Build bottom-up: tooling and config first, then the data layer with tests, then the Electrobun window last. This means the database layer is fully tested before the UI touches it.

---

## Phase 1.1 — Project Scaffolding & Dependencies

### Overview
Create the project skeleton: directory structure, package.json, .gitignore, and install all dependencies.

### Changes Required:

#### 1.1.1 Directory Structure

Create the following directory tree:

```
ghnd/
├── src/
│   ├── bun/
│   │   └── index.ts          # Main process entry
│   ├── mainview/
│   │   ├── index.html         # WebView HTML
│   │   ├── index.css          # WebView styles
│   │   └── index.ts           # WebView entry (renderer)
│   ├── shared/
│   │   └── rpc.ts             # Shared RPC type definitions
│   └── db/
│       ├── client.ts          # Database factory
│       ├── migrations.ts      # Migration runner
│       ├── schema.ts          # Table schemas (SQL strings)
│       └── types.ts           # Row type definitions
├── tests/
│   ├── helpers/
│   │   └── db.ts              # In-memory test DB factory
│   └── db/
│       ├── migrations.test.ts
│       └── queries.test.ts
├── docs/
│   ├── design.md
│   └── plans/
├── package.json
├── tsconfig.json
├── biome.json
├── lefthook.yml
├── electrobun.config.ts
├── .gitignore
└── CLAUDE.md
```

#### 1.1.2 .gitignore

**File**: `.gitignore`

```gitignore
node_modules/
build/
dist/
artifacts/
*.sqlite
*.sqlite-wal
*.sqlite-shm
.DS_Store
lefthook-local.yml
```

#### 1.1.3 package.json

**File**: `package.json`

```json
{
  "name": "ghd",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "electrobun dev",
    "dev:watch": "electrobun dev --watch",
    "start": "electrobun run",
    "build": "electrobun build",
    "check": "biome check .",
    "check:fix": "biome check --write .",
    "format": "biome format --write .",
    "format:check": "biome format .",
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "test:unit": "bun test tests/",
    "postinstall": "lefthook install"
  },
  "dependencies": {
    "electrobun": "latest"
  },
  "devDependencies": {
    "@biomejs/biome": "latest",
    "@types/bun": "latest",
    "lefthook": "latest",
    "typescript": "latest"
  }
}
```

> **Note**: After `bun install`, pin the actual resolved versions by replacing `"latest"` with the installed versions in `package.json`. This ensures reproducible builds.

#### 1.1.4 electrobun.config.ts

**File**: `electrobun.config.ts`

```typescript
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "GHD",
    identifier: "com.albertclerigues.ghd",
    version: "0.0.1",
  },
  runtime: {
    exitOnLastWindowClosed: false, // App stays alive in tray (Phase 7)
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css",
    },
    watchIgnore: ["**/*.test.ts", "**/*.sqlite*"],
  },
} satisfies ElectrobunConfig;
```

### Success Criteria:

#### Automated Verification:
- [ ] `bun install` completes without errors
- [ ] All directories exist as specified

---

## Phase 1.2 — TypeScript Strict Configuration

### Overview
Configure TypeScript at maximum strictness as specified in the design doc, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

### Changes Required:

#### 1.2.1 tsconfig.json

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@db/*": ["./src/db/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "electrobun.config.ts"],
  "exclude": ["node_modules", "build", "dist"]
}
```

**Key strictness flags:**
- `strict: true` — enables all strict mode family flags
- `noUncheckedIndexedAccess` — array/object indexing returns `T | undefined`
- `exactOptionalPropertyTypes` — `{ x?: string }` means `string | undefined`, not `string | undefined | void`
- `noImplicitReturns` — every code path must return
- `noPropertyAccessFromIndexSignature` — forces bracket notation for index signatures

### Success Criteria:

#### Automated Verification:
- [ ] `bun run typecheck` passes with zero errors

---

## Phase 1.3 — Biome & Lefthook Setup

### Overview
Configure Biome for strict linting/formatting and Lefthook for git hooks that enforce quality.

### Changes Required:

#### 1.3.1 biome.json

**File**: `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["src/**", "tests/**", "electrobun.config.ts"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineEnding": "lf",
    "lineWidth": 100
  },
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": {
          "level": "error",
          "options": {
            "maxAllowedComplexity": 10
          }
        }
      },
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "error"
      },
      "suspicious": {
        "noExplicitAny": "error",
        "noDebugger": "error",
        "noDoubleEquals": "error"
      },
      "style": {
        "noNonNullAssertion": "error",
        "useConst": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always",
      "arrowParentheses": "always"
    }
  },
  "overrides": [
    {
      "includes": ["tests/**"],
      "linter": {
        "rules": {
          "suspicious": {
            "noExplicitAny": "warn"
          },
          "style": {
            "noNonNullAssertion": "warn"
          }
        }
      }
    }
  ]
}
```

#### 1.3.2 lefthook.yml

**File**: `lefthook.yml`

```yaml
pre-commit:
  parallel: true
  commands:
    typecheck:
      glob: "*.ts"
      run: bun run typecheck
    lint:
      glob: "*.{ts,json}"
      run: bun run check
    unit-tests:
      run: bun test

pre-push:
  commands:
    typecheck:
      run: bun run typecheck
    lint:
      run: bun run check
    all-tests:
      run: bun test
```

### Success Criteria:

#### Automated Verification:
- [ ] `bun run check` passes with zero errors
- [ ] `bun run typecheck` passes with zero errors
- [ ] `bunx lefthook install` succeeds and hooks are registered

---

## Phase 1.4 — SQLite Schema & Migration Runner

### Overview
Implement the full database schema from the design doc, a versioned migration runner, a database factory, typed row interfaces, and comprehensive tests.

### Changes Required:

#### 1.4.1 Row Type Definitions

**File**: `src/db/types.ts`

```typescript
// Branded type utility for type-safe identifiers
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ThreadId = Brand<string, "ThreadId">;
export type EventId = Brand<string, "EventId">;
export type PinId = Brand<number, "PinId">;
export type ActivityId = Brand<string, "ActivityId">;

// Factory functions for branded types
export function threadId(raw: string): ThreadId {
  return raw as ThreadId;
}

export function eventId(raw: string): EventId {
  return raw as EventId;
}

export function pinId(raw: number): PinId {
  return raw as PinId;
}

export function activityId(raw: string): ActivityId {
  return raw as ActivityId;
}

// Row interfaces matching the SQLite schema
export interface NotificationRow {
  thread_id: string;
  repository: string;
  subject_type: string;
  subject_title: string;
  subject_url: string | null;
  reason: string;
  unread: number; // SQLite boolean
  github_updated_at: string;
  github_last_read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationEventRow {
  notification_thread_id: string;
  event_id: string;
  event_type: string;
  actor: string;
  body: string | null;
  summary: string | null;
  url: string | null;
  event_timestamp: string;
  created_at: string;
}

export interface PinnedRow {
  id: number;
  notification_thread_id: string | null;
  subject_type: string;
  subject_title: string;
  subject_url: string;
  repository: string;
  group_name: string;
  sort_order: number;
  created_at: string;
}

export interface ActivityRow {
  event_id: string;
  event_type: string;
  repository: string;
  action: string;
  target_title: string;
  target_url: string | null;
  event_timestamp: string;
  created_at: string;
}

export interface SyncMetaRow {
  key: string;
  value: string;
  updated_at: string;
}
```

#### 1.4.2 Schema Definitions

**File**: `src/db/schema.ts`

```typescript
// Each migration is a versioned SQL string.
// Migrations are append-only — never modify an existing migration.

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create_notifications",
    sql: `
      CREATE TABLE notifications (
        thread_id          TEXT    PRIMARY KEY,
        repository         TEXT    NOT NULL,
        subject_type       TEXT    NOT NULL,
        subject_title      TEXT    NOT NULL,
        subject_url        TEXT,
        reason             TEXT    NOT NULL,
        unread             INTEGER NOT NULL DEFAULT 1,
        github_updated_at  TEXT    NOT NULL,
        github_last_read_at TEXT,
        dismissed_at       TEXT,
        created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_notifications_repository ON notifications(repository);
      CREATE INDEX idx_notifications_unread ON notifications(unread);
      CREATE INDEX idx_notifications_updated ON notifications(github_updated_at);
    `,
  },
  {
    version: 2,
    name: "create_notification_events",
    sql: `
      CREATE TABLE notification_events (
        notification_thread_id TEXT NOT NULL,
        event_id               TEXT NOT NULL,
        event_type             TEXT NOT NULL,
        actor                  TEXT NOT NULL,
        body                   TEXT,
        summary                TEXT,
        url                    TEXT,
        event_timestamp        TEXT NOT NULL,
        created_at             TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (notification_thread_id, event_id),
        FOREIGN KEY (notification_thread_id)
          REFERENCES notifications(thread_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_events_timestamp ON notification_events(event_timestamp);
    `,
  },
  {
    version: 3,
    name: "create_pinned",
    sql: `
      CREATE TABLE pinned (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_thread_id  TEXT,
        subject_type            TEXT    NOT NULL,
        subject_title           TEXT    NOT NULL,
        subject_url             TEXT    NOT NULL,
        repository              TEXT    NOT NULL,
        group_name              TEXT    NOT NULL DEFAULT 'Default',
        sort_order              INTEGER NOT NULL DEFAULT 0,
        created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (notification_thread_id)
          REFERENCES notifications(thread_id) ON DELETE SET NULL
      );

      CREATE INDEX idx_pinned_group ON pinned(group_name, sort_order);
    `,
  },
  {
    version: 4,
    name: "create_activity",
    sql: `
      CREATE TABLE activity (
        event_id        TEXT PRIMARY KEY,
        event_type      TEXT NOT NULL,
        repository      TEXT NOT NULL,
        action          TEXT NOT NULL,
        target_title    TEXT NOT NULL,
        target_url      TEXT,
        event_timestamp TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_activity_timestamp ON activity(event_timestamp);
      CREATE INDEX idx_activity_repository ON activity(repository);
    `,
  },
  {
    version: 5,
    name: "create_sync_meta",
    sql: `
      CREATE TABLE sync_meta (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
] as const;
```

#### 1.4.3 Migration Runner

**File**: `src/db/migrations.ts`

```typescript
import type { Database } from "bun:sqlite";
import { type Migration, MIGRATIONS } from "./schema.js";

const MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

function ensureMigrationsTable(db: Database): void {
  db.run(MIGRATIONS_TABLE_SQL);
}

function getAppliedVersions(db: Database): Set<number> {
  ensureMigrationsTable(db);
  const rows = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations")
    .all();
  return new Set(rows.map((r) => r.version));
}

export function runMigrations(db: Database): { applied: number } {
  const appliedVersions = getAppliedVersions(db);

  const pending = MIGRATIONS.filter((m) => !appliedVersions.has(m.version)).toSorted(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    return { applied: 0 };
  }

  const applyOne = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    db.run("INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)", [
      migration.version,
      migration.name,
    ]);
  });

  for (const migration of pending) {
    applyOne(migration);
  }

  return { applied: pending.length };
}

export function getMigrationStatus(db: Database): {
  applied: number[];
  pending: number[];
} {
  const appliedVersions = getAppliedVersions(db);
  const allVersions = MIGRATIONS.map((m) => m.version);
  return {
    applied: allVersions.filter((v) => appliedVersions.has(v)),
    pending: allVersions.filter((v) => !appliedVersions.has(v)),
  };
}
```

#### 1.4.4 Database Factory

**File**: `src/db/client.ts`

```typescript
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations.js";

const DEFAULT_DB_DIR = `${process.env["HOME"] ?? "~"}/.ghd`;
const DEFAULT_DB_PATH = `${DEFAULT_DB_DIR}/ghd.sqlite`;

export interface CreateDatabaseOptions {
  path?: string;
  migrate?: boolean;
}

export function createDatabase(options: CreateDatabaseOptions = {}): Database {
  const dbPath = options.path ?? DEFAULT_DB_PATH;
  const shouldMigrate = options.migrate ?? true;

  // Ensure parent directory exists for file-based databases
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");

  if (shouldMigrate) {
    runMigrations(db);
  }

  return db;
}

export function createMemoryDatabase(): Database {
  return createDatabase({ path: ":memory:", migrate: true });
}
```

#### 1.4.5 Test Helper

**File**: `tests/helpers/db.ts`

```typescript
import { createMemoryDatabase } from "../../src/db/client.js";

export { createMemoryDatabase as createTestDatabase };
```

#### 1.4.6 Migration Tests

**File**: `tests/db/migrations.test.ts`

```typescript
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { createMemoryDatabase } from "../../src/db/client.js";
import { getMigrationStatus, runMigrations } from "../../src/db/migrations.js";
import { MIGRATIONS } from "../../src/db/schema.js";

describe("migrations", () => {
  it("applies all migrations to a fresh database", () => {
    const db = createMemoryDatabase();
    const status = getMigrationStatus(db);

    expect(status.applied.length).toBe(MIGRATIONS.length);
    expect(status.pending.length).toBe(0);

    db.close();
  });

  it("is idempotent — running twice applies nothing the second time", () => {
    const db = createMemoryDatabase();
    const result = runMigrations(db);

    expect(result.applied).toBe(0);

    db.close();
  });

  it("creates all expected tables", () => {
    const db = createMemoryDatabase();
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    expect(tables).toContain("notifications");
    expect(tables).toContain("notification_events");
    expect(tables).toContain("pinned");
    expect(tables).toContain("activity");
    expect(tables).toContain("sync_meta");
    expect(tables).toContain("schema_migrations");

    db.close();
  });

  it("creates expected indexes", () => {
    const db = createMemoryDatabase();
    const indexes = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    expect(indexes).toContain("idx_notifications_repository");
    expect(indexes).toContain("idx_notifications_unread");
    expect(indexes).toContain("idx_notifications_updated");
    expect(indexes).toContain("idx_events_timestamp");
    expect(indexes).toContain("idx_pinned_group");
    expect(indexes).toContain("idx_activity_timestamp");
    expect(indexes).toContain("idx_activity_repository");

    db.close();
  });

  it("enforces foreign keys", () => {
    const db = createMemoryDatabase();

    expect(() => {
      db.run(
        `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, event_timestamp)
         VALUES ('nonexistent', 'e1', 'comment', 'user', datetime('now'))`,
      );
    }).toThrow();

    db.close();
  });

  it("enforces notification_events composite unique constraint", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Test issue', 'mention', datetime('now'))`,
    );

    db.run(
      `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, event_timestamp)
       VALUES ('t1', 'e1', 'comment', 'user', datetime('now'))`,
    );

    expect(() => {
      db.run(
        `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, event_timestamp)
         VALUES ('t1', 'e1', 'comment', 'user', datetime('now'))`,
      );
    }).toThrow();

    db.close();
  });

  it("cascades deletes from notifications to notification_events", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Test', 'mention', datetime('now'))`,
    );
    db.run(
      `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, event_timestamp)
       VALUES ('t1', 'e1', 'comment', 'user', datetime('now'))`,
    );

    db.run("DELETE FROM notifications WHERE thread_id = 't1'");

    const events = db
      .query<{ event_id: string }, []>(
        "SELECT event_id FROM notification_events WHERE notification_thread_id = 't1'",
      )
      .all();

    expect(events.length).toBe(0);

    db.close();
  });

  it("sets NULL on pinned when referenced notification is deleted", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Test', 'mention', datetime('now'))`,
    );
    db.run(
      `INSERT INTO pinned (notification_thread_id, subject_type, subject_title, subject_url, repository)
       VALUES ('t1', 'Issue', 'Test', 'https://github.com/test', 'owner/repo')`,
    );

    db.run("DELETE FROM notifications WHERE thread_id = 't1'");

    const pin = db
      .query<{ notification_thread_id: string | null }, []>(
        "SELECT notification_thread_id FROM pinned LIMIT 1",
      )
      .get();

    expect(pin?.notification_thread_id).toBeNull();

    db.close();
  });
});
```

#### 1.4.7 Query Tests

**File**: `tests/db/queries.test.ts`

```typescript
import { describe, expect, it } from "bun:test";
import { createMemoryDatabase } from "../../src/db/client.js";
import type {
  ActivityRow,
  NotificationEventRow,
  NotificationRow,
  PinnedRow,
  SyncMetaRow,
} from "../../src/db/types.js";

describe("notifications CRUD", () => {
  it("inserts and retrieves a notification", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Bug report', 'mention', '2026-03-10T00:00:00Z')`,
    );

    const row = db
      .query<NotificationRow, [string]>("SELECT * FROM notifications WHERE thread_id = ?1")
      .get("t1");

    expect(row).not.toBeNull();
    expect(row?.repository).toBe("owner/repo");
    expect(row?.subject_title).toBe("Bug report");
    expect(row?.unread).toBe(1);
    expect(row?.dismissed_at).toBeNull();

    db.close();
  });

  it("updates notification read status", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Bug', 'mention', '2026-03-10T00:00:00Z')`,
    );

    db.run("UPDATE notifications SET unread = 0 WHERE thread_id = 't1'");

    const row = db
      .query<NotificationRow, [string]>("SELECT * FROM notifications WHERE thread_id = ?1")
      .get("t1");

    expect(row?.unread).toBe(0);

    db.close();
  });
});

describe("notification_events CRUD", () => {
  it("inserts events linked to a notification", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO notifications (thread_id, repository, subject_type, subject_title, reason, github_updated_at)
       VALUES ('t1', 'owner/repo', 'Issue', 'Bug', 'mention', '2026-03-10T00:00:00Z')`,
    );

    db.run(
      `INSERT INTO notification_events (notification_thread_id, event_id, event_type, actor, body, summary, event_timestamp)
       VALUES ('t1', 'e1', 'comment', 'alice', 'This is a long comment...', 'Alice commented on the bug', '2026-03-10T01:00:00Z')`,
    );

    const events = db
      .query<NotificationEventRow, [string]>(
        "SELECT * FROM notification_events WHERE notification_thread_id = ?1 ORDER BY event_timestamp",
      )
      .all("t1");

    expect(events.length).toBe(1);
    expect(events[0]?.actor).toBe("alice");
    expect(events[0]?.summary).toBe("Alice commented on the bug");

    db.close();
  });
});

describe("pinned CRUD", () => {
  it("inserts a pinned item with group and sort order", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO pinned (subject_type, subject_title, subject_url, repository, group_name, sort_order)
       VALUES ('PullRequest', 'Add feature X', 'https://github.com/owner/repo/pull/1', 'owner/repo', 'In Progress', 1)`,
    );

    const pins = db
      .query<PinnedRow, [string]>("SELECT * FROM pinned WHERE group_name = ?1 ORDER BY sort_order")
      .all("In Progress");

    expect(pins.length).toBe(1);
    expect(pins[0]?.subject_title).toBe("Add feature X");
    expect(pins[0]?.sort_order).toBe(1);

    db.close();
  });
});

describe("activity CRUD", () => {
  it("inserts and queries activity events", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO activity (event_id, event_type, repository, action, target_title, target_url, event_timestamp)
       VALUES ('a1', 'PushEvent', 'owner/repo', 'committed', 'Fix typo', 'https://github.com/owner/repo/commit/abc', '2026-03-10T00:00:00Z')`,
    );

    const rows = db
      .query<ActivityRow, []>("SELECT * FROM activity ORDER BY event_timestamp DESC")
      .all();

    expect(rows.length).toBe(1);
    expect(rows[0]?.action).toBe("committed");

    db.close();
  });
});

describe("sync_meta CRUD", () => {
  it("stores and retrieves sync metadata", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO sync_meta (key, value) VALUES ('notifications_last_poll', '2026-03-10T00:00:00Z')`,
    );

    const row = db
      .query<SyncMetaRow, [string]>("SELECT * FROM sync_meta WHERE key = ?1")
      .get("notifications_last_poll");

    expect(row?.value).toBe("2026-03-10T00:00:00Z");

    db.close();
  });

  it("upserts sync metadata", () => {
    const db = createMemoryDatabase();

    db.run(
      `INSERT INTO sync_meta (key, value) VALUES ('last_poll', '2026-03-09T00:00:00Z')`,
    );
    db.run(
      `INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES ('last_poll', '2026-03-10T00:00:00Z', datetime('now'))`,
    );

    const row = db
      .query<SyncMetaRow, [string]>("SELECT * FROM sync_meta WHERE key = ?1")
      .get("last_poll");

    expect(row?.value).toBe("2026-03-10T00:00:00Z");

    db.close();
  });
});
```

### Success Criteria:

#### Automated Verification:
- [ ] `bun run typecheck` passes
- [ ] `bun run check` passes
- [ ] `bun test` passes — all migration and query tests green

---

## Phase 1.5 — Electrobun Hello-World Window

### Overview
Create the Bun main process entry, a static HTML page with the tab shell skeleton, and wire up database initialization on launch.

### Changes Required:

#### 1.5.1 Shared RPC Types (Minimal Scaffold)

**File**: `src/shared/rpc.ts`

```typescript
import type { RPCSchema } from "electrobun/bun";

// Minimal RPC schema for Phase 1.
// Will be expanded in Phase 3 with real handlers.
export type GHDRpcSchema = {
  bun: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
};
```

> **Note**: The exact shape of the RPC type depends on Electrobun's actual API. The above follows the pattern from the docs but may need adjustment after `bun install` reveals the real type definitions. If `RPCSchema` isn't the right generic, adapt to match `node_modules/electrobun` types.

#### 1.5.2 Bun Main Process

**File**: `src/bun/index.ts`

```typescript
import { BrowserWindow } from "electrobun/bun";
import { createDatabase } from "../db/client.js";

// Initialize the database on launch
const db = createDatabase();

const win = new BrowserWindow({
  title: "GHD — GitHub Notification Dashboard",
  url: "views://mainview/index.html",
  frame: { width: 900, height: 700, x: 100, y: 100 },
  titleBarStyle: "hiddenInset",
});
```

> **Note**: The exact `BrowserWindow` constructor API and import path depend on the installed Electrobun version. Adjust imports and options to match the real API after installation. The key intent is: create a window with `hiddenInset` titlebar loading the mainview HTML, and initialize the database.

#### 1.5.3 WebView HTML

**File**: `src/mainview/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GHD</title>
  <link rel="stylesheet" href="index.css">
</head>
<body>
  <header id="titlebar">
    <nav id="tabs">
      <button class="tab active" data-tab="notifications">Notifications</button>
      <button class="tab" data-tab="pinned">Pinned</button>
      <button class="tab" data-tab="activity">Activity</button>
    </nav>
  </header>

  <main id="content">
    <section id="tab-notifications" class="tab-panel active">
      <p class="placeholder">Notifications will appear here.</p>
    </section>
    <section id="tab-pinned" class="tab-panel">
      <p class="placeholder">Pinned items will appear here.</p>
    </section>
    <section id="tab-activity" class="tab-panel">
      <p class="placeholder">Activity feed will appear here.</p>
    </section>
  </main>

  <script src="index.js"></script>
</body>
</html>
```

#### 1.5.4 WebView CSS

**File**: `src/mainview/index.css`

```css
:root {
  --titlebar-height: 52px;
  --bg: #1e1e2e;
  --surface: #282838;
  --text: #cdd6f4;
  --text-muted: #6c7086;
  --accent: #89b4fa;
  --border: #45475a;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  overflow: hidden;
}

#titlebar {
  height: var(--titlebar-height);
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 80px; /* space for traffic lights */
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

#tabs {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.tab {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tab:hover {
  background: var(--border);
  color: var(--text);
}

.tab.active {
  background: var(--accent);
  color: var(--bg);
}

#content {
  height: calc(100vh - var(--titlebar-height));
  overflow-y: auto;
  padding: 16px;
}

.tab-panel {
  display: none;
}

.tab-panel.active {
  display: block;
}

.placeholder {
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
  padding-top: 40vh;
}
```

#### 1.5.5 WebView Entry (Renderer)

**File**: `src/mainview/index.ts`

```typescript
// Tab switching logic
function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
  const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset["tab"];
      if (!target) return;

      for (const t of tabs) t.classList.remove("active");
      for (const p of panels) p.classList.remove("active");

      tab.classList.add("active");
      document.getElementById(`tab-${target}`)?.classList.add("active");
    });
  }
}

document.addEventListener("DOMContentLoaded", initTabs);
```

### Success Criteria:

#### Automated Verification:
- [ ] `bun run typecheck` passes
- [ ] `bun run check` passes
- [ ] `bun test` passes

#### Manual Verification:
- [ ] `bun run dev` launches a native macOS window with traffic lights inset
- [ ] Three tab buttons are visible and clicking them switches the visible content
- [ ] `~/.ghd/ghd.sqlite` exists after launch
- [ ] Opening the database shows all 5 tables + schema_migrations: `sqlite3 ~/.ghd/ghd.sqlite ".tables"`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the window launches correctly and the database is created before proceeding to Phase 2.

---

## Testing Strategy

### Unit Tests:
- Migration idempotency (run twice, second is no-op)
- All tables created with correct columns
- All indexes created
- Foreign key enforcement (insert with nonexistent FK throws)
- Cascade delete behavior (notifications → events)
- SET NULL behavior (notifications → pinned)
- Composite unique constraint on notification_events

### Integration Tests:
- Full CRUD lifecycle for each table
- Upsert behavior for sync_meta
- In-memory database creates and migrates in under 10ms

### What's NOT Tested:
- Electrobun window rendering (framework trust boundary)
- RPC wiring (deferred to Phase 3)
- Tab switching UI behavior (manual verification)

## Performance Considerations

- WAL journal mode enables concurrent reads during writes
- In-memory test databases instantiate in <1ms
- Indexes on all columns used in WHERE/ORDER BY clauses for future query patterns
- Foreign keys enabled for data integrity from day one

## References

- Design doc: `docs/design.md`
- Electrobun docs: https://blackboard.sh/electrobun/docs/
- Electrobun config reference: https://blackboard.sh/electrobun/docs/apis/cli/build-configuration/
- BrowserWindow API: https://blackboard.sh/electrobun/docs/apis/browser-window/
- bun:sqlite docs: https://bun.sh/docs/api/sqlite
- Biome docs: https://biomejs.dev/
- Lefthook docs: https://github.com/evilmartians/lefthook
