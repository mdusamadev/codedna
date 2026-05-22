/** Database schema definitions and migration runner. */

export const CURRENT_SCHEMA_VERSION = 1;

/** SQL for each migration version (run sequentially) */
export const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS edit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      chars_added INTEGER NOT NULL DEFAULT 0,
      chars_removed INTEGER NOT NULL DEFAULT 0,
      classification TEXT NOT NULL CHECK(classification IN ('human','ai_generated','ai_modified','ambiguous')),
      confidence REAL NOT NULL DEFAULT 0.5,
      source_hint TEXT DEFAULT 'unknown',
      language TEXT DEFAULT 'plaintext'
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON edit_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_session   ON edit_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_file      ON edit_events(file_path);

    CREATE TABLE IF NOT EXISTS line_provenance (
      file_path TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      classification TEXT NOT NULL,
      confidence REAL NOT NULL,
      last_updated INTEGER NOT NULL,
      PRIMARY KEY (file_path, line_number)
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      date TEXT NOT NULL,
      file_path TEXT,
      human_lines INTEGER DEFAULT 0,
      ai_lines INTEGER DEFAULT 0,
      ai_modified_lines INTEGER DEFAULT 0,
      ambiguous_lines INTEGER DEFAULT 0,
      total_chars INTEGER DEFAULT 0,
      active_minutes INTEGER DEFAULT 0,
      PRIMARY KEY (date, file_path)
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '1');
  `,
};

import type { SqliteAdapter } from './sqlite-adapter';

/** Run all pending migrations on an open database connection. */
export function runMigrations(db: SqliteAdapter): void {
  // Ensure metadata table exists so we can read the version
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const row = db
    .prepare('SELECT value FROM metadata WHERE key = ?')
    .get('schema_version') as { value: string } | undefined;

  const currentVersion = row ? parseInt(row.value, 10) : 0;

  for (let v = currentVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const sql = MIGRATIONS[v];
    if (sql) {
      db.exec(sql);
    }
  }
}
