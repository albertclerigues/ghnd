import type { Database } from "bun:sqlite";
import { MIGRATIONS, type Migration } from "./schema.js";

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
  const rows = db.query<{ version: number }, []>("SELECT version FROM schema_migrations").all();
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
