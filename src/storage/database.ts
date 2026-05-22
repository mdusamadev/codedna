import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger';
import { runMigrations } from './schema';
import {
  createBetterSqlite3Adapter,
  createSqlJsAdapter,
  type SqliteAdapter,
} from './sqlite-adapter';
import type {
  ClassifiedEditEvent,
  TodaySummary,
  TrendEntry,
  LineProvenance,
  FileBreakdownEntry,
} from '../utils/types';
import { normalizeLineSpan } from '../utils/edit-span';

/**
 * SQLite-backed persistent storage for CodeDNA.
 *
 * Initialization strategy (tried in order):
 *  1. better-sqlite3 — native module, fastest, requires matching Electron ABI
 *  2. sql.js        — WebAssembly, no native module, persists via file I/O
 *  3. Degraded mode — in-memory only, data lost on restart
 *
 * All database access goes through the SqliteAdapter interface so the calling
 * code is completely unaware of which backend is active.
 */
export class Database {
  private readonly logger = Logger.getInstance();
  private db: SqliteAdapter | null = null;

  /** True when both native and WASM backends failed — data is not persisted. */
  inMemoryMode = false;

  /** 'better-sqlite3' | 'sql.js' | 'none' */
  activeBackend: string = 'none';

  // ── Public lifecycle ────────────────────────────────────────────────────────

  /** Open the database at storagePath, trying backends in priority order. */
  async initialize(storagePath: string): Promise<void> {
    fs.mkdirSync(storagePath, { recursive: true });
    const dbPath = path.join(storagePath, 'codedna.db');

    // 1. Try better-sqlite3 (native, WAL-capable)
    const bs3 = this.tryBetterSqlite3(dbPath);
    if (bs3) {
      this.db = bs3;
      this.activeBackend = 'better-sqlite3';
      this.logger.info(`Database opened with better-sqlite3 at: ${dbPath}`);
      return;
    }

    // 2. Fall back to sql.js (WebAssembly — works in every Electron version)
    const sqljsAdapter = await this.trySqlJs(dbPath);
    if (sqljsAdapter) {
      this.db = sqljsAdapter;
      this.activeBackend = 'sql.js';
      this.logger.warn(
        'better-sqlite3 unavailable — using sql.js fallback. ' +
          'Data persists but WAL mode is disabled.',
      );
      return;
    }

    // 3. Both backends failed — no persistence
    this.inMemoryMode = true;
    this.activeBackend = 'none';
    this.logger.error(
      'All SQLite backends failed. Running without persistence. ' +
        'Check the output channel for details.',
    );
  }

  /** Open an in-memory database using better-sqlite3 (used by tests). */
  initializeInMemory(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    const rawDb = new BetterSqlite3(':memory:');
    const adapter = createBetterSqlite3Adapter(rawDb, null);
    adapter.pragma('journal_mode = WAL');
    runMigrations(adapter);
    this.db = adapter;
    this.activeBackend = 'better-sqlite3';
  }

  // ── Write operations ────────────────────────────────────────────────────────

  /** Batch-insert classified edit events inside a single transaction. */
  insertEditEvents(events: readonly ClassifiedEditEvent[]): void {
    if (!this.db || this.inMemoryMode || events.length === 0) return;

    const insert = this.db.prepare(`
      INSERT INTO edit_events
        (timestamp, session_id, file_path, line_start, line_end,
         chars_added, chars_removed, classification, confidence, source_hint, language,
         meaningful_chars_added)
      VALUES
        (@timestamp, @sessionId, @filePath, @lineStart, @lineEnd,
         @charsAdded, @charsRemoved, @classification, @confidence, @sourceHint, @language,
         @meaningfulCharsAdded)
    `);

    const run = this.db.transaction((evts: readonly ClassifiedEditEvent[]) => {
      for (const e of evts) {
        const { lineStart, lineEnd } = normalizeLineSpan(e);
        insert.run({
          timestamp: e.timestamp,
          sessionId: e.sessionId,
          filePath: e.filePath,
          lineStart,
          lineEnd,
          charsAdded: e.charsAdded,
          charsRemoved: e.charsRemoved,
          classification: e.classification,
          confidence: e.confidence,
          sourceHint: e.sourceHint,
          language: e.language,
          meaningfulCharsAdded: e.meaningfulCharsAdded ?? e.charsAdded,
        });
      }
    });

    run(events);
    this.logger.debug(`Inserted ${events.length} events`);
  }

  /** Upsert line provenance entries. */
  upsertLineProvenance(entries: readonly LineProvenance[]): void {
    if (!this.db || this.inMemoryMode || entries.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT INTO line_provenance (file_path, line_number, classification, confidence, last_updated)
      VALUES (@filePath, @lineNumber, @classification, @confidence, @lastUpdated)
      ON CONFLICT(file_path, line_number) DO UPDATE SET
        classification = excluded.classification,
        confidence = excluded.confidence,
        last_updated = excluded.last_updated
    `);

    const run = this.db.transaction((rows: readonly LineProvenance[]) => {
      for (const r of rows) {
        stmt.run({ filePath: r.filePath, lineNumber: r.lineNumber, classification: r.classification, confidence: r.confidence, lastUpdated: r.lastUpdated });
      }
    });
    run(entries);
  }

  /** Delete events older than retentionDays. Returns number of deleted rows. */
  pruneOldData(retentionDays: number): number {
    if (!this.db || this.inMemoryMode) return 0;

    const cutoffMs = Date.now() - retentionDays * 86_400_000;
    const result = this.db
      .prepare('DELETE FROM edit_events WHERE timestamp < ?')
      .run(cutoffMs);

    if (result.changes > 0 && this.activeBackend === 'better-sqlite3') {
      this.db.pragma('incremental_vacuum');
    }
    return result.changes;
  }

  /** Drop and recreate all tables (reset command). */
  resetAllData(): void {
    if (!this.db || this.inMemoryMode) return;
    this.db.exec(`
      DROP TABLE IF EXISTS edit_events;
      DROP TABLE IF EXISTS line_provenance;
      DROP TABLE IF EXISTS daily_summaries;
      DROP TABLE IF EXISTS metadata;
    `);
    runMigrations(this.db);
    this.logger.info('All data reset');
  }

  // ── Read operations ─────────────────────────────────────────────────────────

  /** Today's aggregate summary (midnight UTC to now). */
  getTodaySummary(): TodaySummary {
    const empty: TodaySummary = {
      sessionDuration: 0, activeMinutes: 0, totalLines: 0,
      humanLines: 0, aiLines: 0, aiModifiedLines: 0, ambiguousLines: 0,
      totalChars: 0, humanChars: 0, aiChars: 0, ambiguousChars: 0,
      humanPercent: 0, aiPercent: 0, ambiguousPercent: 0,
      aiReviewRate: 0, mostProductiveHour: null, fileBreakdown: [],
    };

    if (!this.db || this.inMemoryMode) return empty;

    const todayStart = this.todayStartMs();
    const now = Date.now();

    // ── Step 1: distinct physical lines with their FINAL classification ───────
    // Expand each event's [line_start, line_end] span so multi-line AI inserts
    // count every affected line (not just the insertion anchor).
    const row = this.db
      .prepare(`
        WITH RECURSIVE line_expansion AS (
          SELECT file_path, line_start AS line_num, line_end, classification, timestamp
          FROM edit_events
          WHERE timestamp >= ? AND timestamp <= ?
          UNION ALL
          SELECT file_path, line_num + 1, line_end, classification, timestamp
          FROM line_expansion
          WHERE line_num < line_end
        ),
        latest_per_line AS (
          SELECT
            file_path,
            line_num,
            classification,
            ROW_NUMBER() OVER (
              PARTITION BY file_path, line_num
              ORDER BY timestamp DESC
            ) AS rn
          FROM line_expansion
        )
        SELECT
          COUNT(*)                                                              AS total,
          SUM(CASE WHEN classification = 'human'        THEN 1 ELSE 0 END)     AS human,
          SUM(CASE WHEN classification = 'ai_generated' THEN 1 ELSE 0 END)     AS ai_gen,
          SUM(CASE WHEN classification = 'ai_modified'  THEN 1 ELSE 0 END)     AS ai_mod,
          SUM(CASE WHEN classification = 'ambiguous'    THEN 1 ELSE 0 END)     AS ambiguous
        FROM latest_per_line
        WHERE rn = 1
      `)
      .get(todayStart, now) as {
        total: number; human: number; ai_gen: number; ai_mod: number; ambiguous: number;
      } | undefined;

    if (!row || row.total === 0) return empty;

    // Character-weighted ratio (same method as the status bar).
    const charRow = this.db
      .prepare(`
        SELECT
          SUM(chars_added) AS total_chars,
          SUM(CASE WHEN classification = 'human'
                   THEN chars_added ELSE 0 END) AS human_chars,
          SUM(CASE WHEN classification IN ('ai_generated', 'ai_modified')
                   THEN chars_added ELSE 0 END) AS ai_chars,
          SUM(CASE WHEN classification = 'ambiguous'
                   THEN chars_added ELSE 0 END) AS ambiguous_chars
        FROM edit_events
        WHERE timestamp >= ? AND timestamp <= ?
      `)
      .get(todayStart, now) as {
        total_chars: number; human_chars: number; ai_chars: number; ambiguous_chars: number;
      } | undefined;

    const humanChars = charRow?.human_chars ?? 0;
    const aiChars = charRow?.ai_chars ?? 0;
    const ambiguousChars = charRow?.ambiguous_chars ?? 0;
    const totalChars = charRow?.total_chars ?? 0;

    // ── Step 2: session timing ─────────────────────────────────────────────────
    // activeMinutes = distinct 1-minute buckets that had at least one edit.
    // sessionDuration = span from first to last event (actual coding time).
    const timingRow = this.db
      .prepare(`
        SELECT
          MIN(timestamp)                             AS first_event,
          MAX(timestamp)                             AS last_event,
          COUNT(DISTINCT timestamp / 60000)          AS active_minutes
        FROM edit_events
        WHERE timestamp >= ? AND timestamp <= ?
      `)
      .get(todayStart, now) as {
        first_event: number; last_event: number; active_minutes: number;
      } | undefined;

    const activeMinutes = timingRow?.active_minutes ?? 0;
    const sessionDuration = timingRow
      ? timingRow.last_event - timingRow.first_event
      : 0;

    const { total } = row;
    const aiLines = row.ai_gen + row.ai_mod;
    const reviewRate = row.ai_gen > 0 ? Math.round((row.ai_mod / row.ai_gen) * 100) : 0;

    const charTotal = humanChars + aiChars + ambiguousChars;
    const humanPct = charTotal > 0 ? Math.round((humanChars / charTotal) * 100) : 0;
    const aiPct = charTotal > 0 ? Math.round((aiChars / charTotal) * 100) : 0;
    const ambPct = charTotal > 0 ? 100 - humanPct - aiPct : 0;

    // ── Step 3: per-file breakdown (line counts + char-weighted %) ─────────────
    const fileRows = this.db
      .prepare(`
        WITH RECURSIVE line_expansion AS (
          SELECT file_path, line_start AS line_num, line_end, classification, timestamp
          FROM edit_events
          WHERE timestamp >= ? AND timestamp <= ?
          UNION ALL
          SELECT file_path, line_num + 1, line_end, classification, timestamp
          FROM line_expansion
          WHERE line_num < line_end
        ),
        latest_per_line AS (
          SELECT
            file_path,
            line_num,
            classification,
            ROW_NUMBER() OVER (
              PARTITION BY file_path, line_num
              ORDER BY timestamp DESC
            ) AS rn
          FROM line_expansion
        ),
        line_counts AS (
          SELECT file_path, COUNT(*) AS total
          FROM latest_per_line
          WHERE rn = 1
          GROUP BY file_path
        ),
        char_totals AS (
          SELECT
            file_path,
            SUM(CASE WHEN classification = 'human' THEN chars_added ELSE 0 END) AS human_chars,
            SUM(CASE WHEN classification IN ('ai_generated', 'ai_modified')
                     THEN chars_added ELSE 0 END) AS ai_chars
          FROM edit_events
          WHERE timestamp >= ? AND timestamp <= ?
          GROUP BY file_path
        )
        SELECT
          c.file_path,
          COALESCE(l.total, 0) AS total,
          c.human_chars,
          c.ai_chars
        FROM char_totals c
        LEFT JOIN line_counts l ON l.file_path = c.file_path
        ORDER BY c.ai_chars DESC
        LIMIT 20
      `)
      .all(todayStart, now, todayStart, now) as Array<{
        file_path: string; total: number; human_chars: number; ai_chars: number;
      }>;

    const fileBreakdown: FileBreakdownEntry[] = fileRows.map((r) => {
      const fileCharTotal = r.human_chars + r.ai_chars;
      return {
        filePath: r.file_path,
        humanPercent: fileCharTotal > 0 ? Math.round((r.human_chars / fileCharTotal) * 100) : 0,
        aiPercent: fileCharTotal > 0 ? Math.round((r.ai_chars / fileCharTotal) * 100) : 0,
        totalLines: r.total,
        humanChars: r.human_chars,
        aiChars: r.ai_chars,
        totalChars: fileCharTotal,
      };
    });

    // ── Step 4: most productive hour in LOCAL time ────────────────────────────
    // Shift timestamps by the local UTC offset before computing the hour bucket
    // so the result reflects the user's clock, not UTC.
    const tz = this.tzOffsetMs();
    const hourRow = this.db
      .prepare(`
        SELECT ((timestamp - ${tz}) / 3600000 % 24) AS hour, COUNT(DISTINCT line_start) AS n
        FROM edit_events
        WHERE timestamp >= ? AND timestamp <= ? AND classification = 'human'
        GROUP BY hour
        ORDER BY n DESC
        LIMIT 1
      `)
      .get(todayStart, now) as { hour: number } | undefined;

    return {
      sessionDuration,
      activeMinutes,
      totalLines: total,
      humanLines: row.human,
      aiLines,
      aiModifiedLines: row.ai_mod,
      ambiguousLines: row.ambiguous,
      totalChars,
      humanChars,
      aiChars,
      ambiguousChars,
      humanPercent: humanPct,
      aiPercent: aiPct,
      ambiguousPercent: ambPct,
      aiReviewRate: reviewRate,
      mostProductiveHour: hourRow ? hourRow.hour : null,
      fileBreakdown,
    };
  }

  /** Daily aggregated trends between two YYYY-MM-DD date strings (local dates). */
  getTrends(startDate: string, endDate: string): TrendEntry[] {
    if (!this.db || this.inMemoryMode) return [];

    // Parse date strings as LOCAL midnight so the range matches what the user sees
    const startMs = this.localMidnightMs(startDate);
    const endMs = this.localMidnightMs(endDate) + 86_400_000;
    const tz = this.tzOffsetMs();

    const rows = this.db
      .prepare(`
        SELECT
          strftime('%Y-%m-%d', (timestamp - ${tz}) / 1000, 'unixepoch') AS date,
          SUM(CASE WHEN classification = 'human'        THEN 1 ELSE 0 END) AS human,
          SUM(CASE WHEN classification = 'ai_generated' THEN 1 ELSE 0 END) AS ai_gen,
          SUM(CASE WHEN classification = 'ai_modified'  THEN 1 ELSE 0 END) AS ai_mod,
          SUM(CASE WHEN classification = 'ambiguous'    THEN 1 ELSE 0 END) AS ambiguous,
          SUM(CASE WHEN classification = 'human'        THEN chars_added ELSE 0 END) AS human_chars,
          SUM(CASE WHEN classification IN ('ai_generated', 'ai_modified')
                   THEN chars_added ELSE 0 END) AS ai_chars,
          SUM(CASE WHEN classification = 'ambiguous'    THEN chars_added ELSE 0 END) AS ambiguous_chars,
          SUM(chars_added) AS total_chars
        FROM edit_events
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY date
        ORDER BY date ASC
      `)
      .all(startMs, endMs) as Array<{
        date: string; human: number; ai_gen: number;
        ai_mod: number; ambiguous: number;
        human_chars: number; ai_chars: number; ambiguous_chars: number;
        total_chars: number;
      }>;

    return rows.map((r) => ({
      date: r.date,
      humanLines: r.human,
      aiLines: r.ai_gen + r.ai_mod,
      aiModifiedLines: r.ai_mod,
      ambiguousLines: r.ambiguous,
      humanChars: r.human_chars ?? 0,
      aiChars: r.ai_chars ?? 0,
      ambiguousChars: r.ambiguous_chars ?? 0,
      aiReviewRate: r.ai_gen > 0 ? Math.round((r.ai_mod / r.ai_gen) * 100) : 0,
      totalChars: r.total_chars ?? 0,
      activeMinutes: 0,
    }));
  }

  /** Per-line provenance for a file (latest classification per line from edit history). */
  getFileProvenance(filePath: string): LineProvenance[] {
    if (!this.db || this.inMemoryMode) return [];

    const rows = this.db
      .prepare(`
        WITH RECURSIVE line_expansion AS (
          SELECT line_start AS line_num, line_end, classification, confidence, timestamp
          FROM edit_events
          WHERE file_path = ?
          UNION ALL
          SELECT line_num + 1, line_end, classification, confidence, timestamp
          FROM line_expansion
          WHERE line_num < line_end
        ),
        latest_per_line AS (
          SELECT
            line_num AS lineNumber,
            classification,
            confidence,
            timestamp AS lastUpdated,
            ROW_NUMBER() OVER (
              PARTITION BY line_num
              ORDER BY timestamp DESC
            ) AS rn
          FROM line_expansion
        )
        SELECT lineNumber, classification, confidence, lastUpdated
        FROM latest_per_line
        WHERE rn = 1
        ORDER BY lineNumber ASC
      `)
      .all(filePath) as Array<Omit<LineProvenance, 'filePath'>>;

    return rows.map((r) => ({ ...r, filePath }));
  }

  /** True when at least one edit event exists for this file path. */
  hasEventsForFile(filePath: string): boolean {
    if (!this.db || this.inMemoryMode) return false;
    const row = this.db
      .prepare('SELECT 1 AS ok FROM edit_events WHERE file_path = ? LIMIT 1')
      .get(filePath) as { ok: number } | undefined;
    return row !== undefined;
  }

  /** Total number of stored events. */
  getEventCount(): number {
    if (!this.db || this.inMemoryMode) return 0;
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM edit_events')
      .get() as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** Approximate database file size in MB. */
  getDatabaseSizeMB(): number {
    if (!this.db || this.inMemoryMode) return 0;
    try {
      const row = this.db
        .prepare('SELECT page_count, page_size FROM pragma_page_count(), pragma_page_size()')
        .get() as { page_count: number; page_size: number } | undefined;
      if (!row) return 0;
      return (row.page_count * row.page_size) / (1024 * 1024);
    } catch {
      // sql.js may not support the FROM-PRAGMA syntax — fall back to file size
      const fp = this.db.filePath;
      if (fp && fs.existsSync(fp)) {
        return fs.statSync(fp).size / (1024 * 1024);
      }
      return 0;
    }
  }

  /** Current schema version stored in the metadata table. */
  getSchemaVersion(): number {
    if (!this.db) return 0;
    try {
      const row = this.db
        .prepare('SELECT value FROM metadata WHERE key = ?')
        .get('schema_version') as { value: string } | undefined;
      return row ? parseInt(row.value, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * SQLite journal mode.
   * Returns 'wal' for disk+better-sqlite3, 'memory' for in-memory,
   * 'sql.js' for the WASM backend (WAL not supported there).
   */
  getJournalMode(): string {
    if (!this.db) return 'closed';
    if (this.activeBackend === 'sql.js') return 'sql.js';
    const rows = this.db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    return rows[0]?.journal_mode ?? 'unknown';
  }

  /**
   * Per-day breakdown for a specific YYYY-MM-DD date.
   * Returns null when no events exist for that date.
   */
  getDailySummary(date: string): import('../utils/types').DailySummary | null {
    if (!this.db || this.inMemoryMode) return null;

    // Use local midnight so the day boundary matches the user's clock
    const startMs = this.localMidnightMs(date);
    const endMs = startMs + 86_400_000;
    const tz = this.tzOffsetMs();

    const row = this.db
      .prepare(`
        SELECT
          strftime('%Y-%m-%d', (timestamp - ${tz}) / 1000, 'unixepoch') AS date,
          SUM(CASE WHEN classification = 'human'        THEN 1 ELSE 0 END) AS human,
          SUM(CASE WHEN classification = 'ai_generated' THEN 1 ELSE 0 END) AS ai_gen,
          SUM(CASE WHEN classification = 'ai_modified'  THEN 1 ELSE 0 END) AS ai_mod,
          SUM(CASE WHEN classification = 'ambiguous'    THEN 1 ELSE 0 END) AS ambiguous,
          SUM(chars_added) AS total_chars
        FROM edit_events
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY date
      `)
      .get(startMs, endMs) as {
        date: string; human: number; ai_gen: number;
        ai_mod: number; ambiguous: number; total_chars: number;
      } | undefined;

    if (!row) return null;

    return {
      date: row.date,
      filePath: null,
      humanLines: row.human,
      aiLines: row.ai_gen + row.ai_mod,
      aiModifiedLines: row.ai_mod,
      ambiguousLines: row.ambiguous,
      totalChars: row.total_chars ?? 0,
      activeMinutes: 0,
    };
  }

  /** Expose the on-disk path (null for in-memory). For testing only. */
  getDatabaseFilePath(): string | null {
    return this.db?.filePath ?? null;
  }

  /** Close the connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.logger.info('Database connection closed');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private tryBetterSqlite3(dbPath: string): SqliteAdapter | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
      const rawDb = new BetterSqlite3(dbPath);
      const adapter = createBetterSqlite3Adapter(rawDb, dbPath);
      adapter.pragma('journal_mode = WAL');
      adapter.pragma('foreign_keys = ON');
      runMigrations(adapter);
      return adapter;
    } catch (err) {
      this.logger.warn('better-sqlite3 failed to load — will try sql.js', err);
      return null;
    }
  }

  private async trySqlJs(dbPath: string): Promise<SqliteAdapter | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const initSqlJs = require('sql.js') as typeof import('sql.js');
      const SQL = await initSqlJs();

      let sqlJsDb: import('sql.js').Database;
      if (fs.existsSync(dbPath)) {
        // Load existing database from disk
        const fileBuffer = fs.readFileSync(dbPath);
        sqlJsDb = new SQL.Database(new Uint8Array(fileBuffer));
      } else {
        sqlJsDb = new SQL.Database();
      }

      const adapter = createSqlJsAdapter(sqlJsDb, dbPath);
      runMigrations(adapter);
      return adapter;
    } catch (err) {
      this.logger.error('sql.js fallback also failed to initialise', err);
      return null;
    }
  }

  private todayStartMs(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0); // local midnight
    return d.getTime();
  }

  /**
   * Returns the local timezone offset in milliseconds.
   *
   * `Date.getTimezoneOffset()` returns `(UTC − local)` in minutes, so it is
   * negative for UTC+N zones.  Subtracting this from a UTC timestamp converts
   * it to local time.  Example: UTC+5:30 → −330 min → −19 800 000 ms.
   *
   * Usage in SQL: `(timestamp - ${tz}) / 1000` gives a UNIX epoch in local time
   * that `strftime` and integer-division hour/day arithmetic treat correctly.
   */
  private tzOffsetMs(): number {
    return new Date().getTimezoneOffset() * 60_000;
  }

  /**
   * Parse a "YYYY-MM-DD" string as LOCAL midnight (not UTC midnight).
   *
   * `new Date('2026-01-01')` is an ISO-8601 date-only string and is parsed as
   * UTC midnight per spec.  `new Date(y, m-1, d)` uses the LOCAL timezone.
   */
  private localMidnightMs(dateStr: string): number {
    const parts = dateStr.split('-');
    const y = parseInt(parts[0]!, 10);
    const m = parseInt(parts[1]!, 10) - 1; // 0-indexed month
    const d = parseInt(parts[2]!, 10);
    return new Date(y, m, d).getTime(); // local midnight
  }
}
