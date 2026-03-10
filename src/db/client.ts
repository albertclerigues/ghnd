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
