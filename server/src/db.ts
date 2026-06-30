import { Database } from 'bun:sqlite';

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_key   TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key     TEXT NOT NULL REFERENCES users(user_key),
      version      INTEGER NOT NULL,
      profile_json TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      UNIQUE(user_key, version)
    );
    CREATE TABLE IF NOT EXISTS signals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key      TEXT NOT NULL REFERENCES users(user_key),
      type          TEXT NOT NULL,
      surfaced_json TEXT NOT NULL,
      disclosure    TEXT NOT NULL,
      share_token   TEXT UNIQUE,
      from_version  INTEGER NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE(user_key, type)
    );
    CREATE INDEX IF NOT EXISTS idx_signals_share ON signals(share_token);
  `);
  // Two-level disclosure migration: fold legacy 3-level values into 'public' so links
  // shared before the rework keep resolving. Idempotent; safe to run on every boot.
  db.exec("UPDATE signals SET disclosure = 'public' WHERE disclosure IN ('published', 'unlistedLink');");
}

export function createDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}
