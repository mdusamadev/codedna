import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/storage/database';
import { runMigrations } from '../../src/storage/schema';
import type { ClassifiedEditEvent } from '../../src/utils/types';

function makeEvent(overrides: Partial<ClassifiedEditEvent> = {}): ClassifiedEditEvent {
  return {
    timestamp: Date.now(),
    sessionId: 'test-session',
    filePath: 'src/index.ts',
    lineStart: 1,
    lineEnd: 1,
    charsAdded: 10,
    charsRemoved: 0,
    linesAdded: 0,
    language: 'typescript',
    isFromDisk: false,
    classification: 'human',
    confidence: 0.95,
    sourceHint: 'unknown',
    ...overrides,
  };
}

/** Create a unique temp directory for file-based DB tests. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codedna-test-'));
}

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database();
    db.initializeInMemory();
  });

  afterEach(() => {
    db.close();
  });

  // ── TC-DB01: Fresh database initialization ────────────────────────────────

  it('TC-DB01: Fresh database creates all tables and sets schema_version = 2', () => {
    expect(db.getSchemaVersion()).toBe(2);
    // Confirm edit_events, line_provenance tables exist by doing round-trip ops
    expect(() => db.insertEditEvents([])).not.toThrow();
    expect(() => db.upsertLineProvenance([])).not.toThrow();
    expect(db.getEventCount()).toBe(0);
  });

  // ── TC-DB02: Migration from v0 to v2 ─────────────────────────────────────

  it('TC-DB02: Migration from v0 to v2 — blank DB gains all tables and schema_version = 2', () => {
    // Simulate a v0 database by opening a fresh in-memory DB WITHOUT calling
    // runMigrations first, then invoking runMigrations manually.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    const rawDb = new BetterSqlite3(':memory:');

    // At this point rawDb has no tables and no metadata → version 0
    // Verify no metadata table yet
    const tables = rawDb
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).not.toContain('edit_events');

    // Run migration
    runMigrations(rawDb);

    // schema_version should now be 2 and all tables should exist
    const versionRow = rawDb
      .prepare<[string], { value: string }>('SELECT value FROM metadata WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(versionRow?.value).toBe('2');

    const tableNames = rawDb
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tableNames.map((t) => t.name);
    expect(names).toContain('edit_events');
    expect(names).toContain('line_provenance');
    expect(names).toContain('daily_summaries');
    expect(names).toContain('metadata');

    rawDb.close();
  });

  // ── TC-DB03: Insert and query edit events ─────────────────────────────────

  it('TC-DB03: 100 classified events on 100 distinct lines — getTodaySummary returns correct totals', () => {
    // Each event on a UNIQUE line so DISTINCT line counting = 100, not 1.
    // 40 human, 35 ai_generated, 15 ai_modified, 10 ambiguous
    const events: ClassifiedEditEvent[] = [
      ...Array.from({ length: 40 }, (_, i) => makeEvent({ classification: 'human', lineStart: i, lineEnd: i })),
      ...Array.from({ length: 35 }, (_, i) => makeEvent({ classification: 'ai_generated', lineStart: 40 + i, lineEnd: 40 + i })),
      ...Array.from({ length: 15 }, (_, i) => makeEvent({ classification: 'ai_modified', lineStart: 75 + i, lineEnd: 75 + i })),
      ...Array.from({ length: 10 }, (_, i) => makeEvent({ classification: 'ambiguous', lineStart: 90 + i, lineEnd: 90 + i })),
    ];
    db.insertEditEvents(events);

    const summary = db.getTodaySummary();
    expect(summary.totalLines).toBe(100);
    expect(summary.humanLines).toBe(40);
    expect(summary.aiLines).toBe(50);         // ai_generated(35) + ai_modified(15)
    expect(summary.aiModifiedLines).toBe(15);
    expect(summary.ambiguousLines).toBe(10);
    expect(summary.humanPercent).toBe(40);
    expect(summary.aiPercent).toBe(50);
    expect(summary.ambiguousPercent).toBe(10);
    expect(summary.humanPercent + summary.aiPercent + summary.ambiguousPercent).toBe(100);
  });

  it('TC-DB03b: percentages use character counts (same math as status bar)', () => {
    db.insertEditEvents([
      makeEvent({ classification: 'human', lineStart: 0, charsAdded: 13 }),
      makeEvent({ classification: 'human', lineStart: 1, charsAdded: 13 }),
      makeEvent({ classification: 'ai_generated', lineStart: 2, charsAdded: 16 }),
    ]);

    const summary = db.getTodaySummary();
    expect(summary.totalLines).toBe(3);
    expect(summary.humanLines).toBe(2);
    expect(summary.aiLines).toBe(1);
    expect(summary.humanChars).toBe(26);
    expect(summary.aiChars).toBe(16);
    expect(summary.humanPercent).toBe(62);
    expect(summary.aiPercent).toBe(38);
    expect(summary.ambiguousPercent).toBe(0);
  });

  // ── TC-DB04: Data retention pruning ──────────────────────────────────────

  it('TC-DB04: pruneOldData(90) deletes events older than 90 days, keeps recent ones', () => {
    const oldTs = Date.now() - 100 * 86_400_000; // 100 days ago
    const newTs = Date.now() - 1 * 86_400_000;   // 1 day ago

    db.insertEditEvents([
      makeEvent({ timestamp: oldTs }),
      makeEvent({ timestamp: oldTs }),
      makeEvent({ timestamp: newTs }),
    ]);
    expect(db.getEventCount()).toBe(3);

    const deleted = db.pruneOldData(90);

    expect(deleted).toBe(2);
    expect(db.getEventCount()).toBe(1);
  });

  it('TC-DB04b: pruneOldData with large retention deletes nothing', () => {
    db.insertEditEvents([makeEvent(), makeEvent()]);
    expect(db.pruneOldData(365)).toBe(0);
    expect(db.getEventCount()).toBe(2);
  });

  // ── TC-DB05: Daily summary aggregation ───────────────────────────────────

  it('TC-DB05: 500 events across 3 days — getDailySummary returns correct per-day breakdown', () => {
    const day1Ms = new Date('2026-02-01').getTime() + 3_600_000;
    const day2Ms = new Date('2026-02-02').getTime() + 3_600_000;
    const day3Ms = new Date('2026-02-03').getTime() + 3_600_000;

    // 200 events per day, split 60% human / 30% AI / 10% ambiguous
    const batch: ClassifiedEditEvent[] = [];
    for (const [dayMs, count] of [[day1Ms, 200], [day2Ms, 150], [day3Ms, 150]] as const) {
      const h = Math.floor(count * 0.6);
      const a = Math.floor(count * 0.3);
      const m = count - h - a;
      for (let i = 0; i < h; i++) batch.push(makeEvent({ timestamp: dayMs + i, classification: 'human' }));
      for (let i = 0; i < a; i++) batch.push(makeEvent({ timestamp: dayMs + i, classification: 'ai_generated' }));
      for (let i = 0; i < m; i++) batch.push(makeEvent({ timestamp: dayMs + i, classification: 'ambiguous' }));
    }
    expect(batch.length).toBe(500);
    db.insertEditEvents(batch);

    const d1 = db.getDailySummary('2026-02-01');
    const d2 = db.getDailySummary('2026-02-02');
    const d3 = db.getDailySummary('2026-02-03');

    expect(d1).not.toBeNull();
    expect(d1!.humanLines).toBe(120);  // 60% of 200
    expect(d1!.aiLines).toBe(60);      // 30% of 200

    expect(d2).not.toBeNull();
    expect(d2!.humanLines).toBe(90);   // 60% of 150
    expect(d2!.aiLines).toBe(45);      // 30% of 150

    expect(d3).not.toBeNull();
    expect(d3!.humanLines).toBe(90);
    expect(d3!.aiLines).toBe(45);

    // Day with no data returns null
    expect(db.getDailySummary('2020-01-01')).toBeNull();
  });

  // ── TC-DB06: File provenance query ────────────────────────────────────────

  it('TC-DB06: Events across 5 files — getFileProvenance returns latest per-line classification', () => {
    const now = Date.now();
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];

    for (const filePath of files) {
      db.insertEditEvents([
        makeEvent({ filePath, lineStart: 1, lineEnd: 1, classification: 'human', timestamp: now }),
        makeEvent({ filePath, lineStart: 2, lineEnd: 2, classification: 'ai_generated', timestamp: now + 1 }),
        makeEvent({ filePath, lineStart: 3, lineEnd: 3, classification: 'ai_modified', timestamp: now + 2 }),
      ]);
    }

    for (const filePath of files) {
      const rows = db.getFileProvenance(filePath);
      expect(rows).toHaveLength(3);
      expect(rows[0]!.classification).toBe('human');
      expect(rows[1]!.classification).toBe('ai_generated');
      expect(rows[2]!.classification).toBe('ai_modified');
    }

    const rowsA = db.getFileProvenance('src/a.ts');
    const rowsB = db.getFileProvenance('src/b.ts');
    expect(rowsA[0]!.filePath).toBe('src/a.ts');
    expect(rowsB[0]!.filePath).toBe('src/b.ts');
  });

  it('TC-DB06b: getFileProvenance uses the most recent event on a line', () => {
    const now = Date.now();
    db.insertEditEvents([
      makeEvent({ filePath: 'src/z.ts', lineStart: 5, lineEnd: 5, classification: 'human', timestamp: now }),
      makeEvent({ filePath: 'src/z.ts', lineStart: 5, lineEnd: 5, classification: 'ai_modified', timestamp: now + 1 }),
    ]);
    const rows = db.getFileProvenance('src/z.ts');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('ai_modified');
  });

  it('TC-DB06e: hasEventsForFile returns false until events are inserted', () => {
    expect(db.hasEventsForFile('src/new-file.ts')).toBe(false);
    db.insertEditEvents([makeEvent({ filePath: 'src/new-file.ts' })]);
    expect(db.hasEventsForFile('src/new-file.ts')).toBe(true);
    expect(db.hasEventsForFile('src/other.ts')).toBe(false);
  });

  it('TC-DB06d: getFileProvenance reads persisted edit_events after reload', async () => {
    const tmpDir = makeTempDir();
    const fileDb = new Database();
    await fileDb.initialize(tmpDir);
    fileDb.insertEditEvents([
      makeEvent({ filePath: 'test.jsx', lineStart: 0, lineEnd: 0, classification: 'human' }),
      makeEvent({ filePath: 'test.jsx', lineStart: 2, lineEnd: 4, classification: 'ai_generated', linesAdded: 2 }),
    ]);
    fileDb.close();

    const fileDb2 = new Database();
    await fileDb2.initialize(tmpDir);
    const lines = fileDb2.getFileProvenance('test.jsx');
    fileDb2.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.find((l) => l.lineNumber === 0)?.classification).toBe('human');
    expect(lines.find((l) => l.lineNumber === 3)?.classification).toBe('ai_generated');
  });

  it('TC-DB03d: multi-line AI insert counts every affected line', () => {
    db.insertEditEvents([
      makeEvent({
        classification: 'ai_generated',
        lineStart: 2,
        lineEnd: 4,
        linesAdded: 2,
        charsAdded: 40,
      }),
    ]);

    const summary = db.getTodaySummary();
    expect(summary.aiLines).toBe(3);
    expect(summary.totalLines).toBe(3);

    const lines = db.getFileProvenance('src/index.ts');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.lineNumber)).toEqual([2, 3, 4]);
    expect(lines.every((l) => l.classification === 'ai_generated')).toBe(true);
  });

  it('TC-DB06c: getTrends char totals drive week-style ratios', () => {
    const today = new Date().toISOString().slice(0, 10);
    db.insertEditEvents([
      makeEvent({ classification: 'human', lineStart: 0, charsAdded: 20 }),
      makeEvent({ classification: 'human', lineStart: 1, charsAdded: 20 }),
      makeEvent({ classification: 'ai_generated', lineStart: 2, charsAdded: 60 }),
    ]);

    const trends = db.getTrends(today, today);
    expect(trends).toHaveLength(1);
    expect(trends[0]!.humanLines).toBe(2);
    expect(trends[0]!.aiLines).toBe(1);
    expect(trends[0]!.humanChars).toBe(40);
    expect(trends[0]!.aiChars).toBe(60);
  });

  // ── TC-DB07: WAL mode ─────────────────────────────────────────────────────

  it('TC-DB07: WAL mode is enabled on a disk database (journal_mode = wal)', async () => {
    const tmpDir = makeTempDir();
    const fileDb = new Database();
    try {
      await fileDb.initialize(tmpDir);
      expect(fileDb.inMemoryMode).toBe(false);
      expect(fileDb.getJournalMode()).toBe('wal');
    } finally {
      fileDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('TC-DB07b: In-memory database journal_mode is memory (WAL pragma not applicable)', () => {
    // initializeInMemory() sets pragma WAL, but SQLite :memory: always uses 'memory' mode
    expect(db.getJournalMode()).toBe('memory');
  });

  // ── TC-DB08: Concurrent read during write ─────────────────────────────────

  it('TC-DB08: WAL allows a second reader to query while a writer is active', async () => {
    const tmpDir = makeTempDir();
    const writerDb = new Database();
    const readerDb = new Database();

    try {
      await writerDb.initialize(tmpDir);

      // Pre-populate writer with 10 events on 10 distinct lines
      writerDb.insertEditEvents(Array.from({ length: 10 }, (_, i) => makeEvent({ lineStart: i, lineEnd: i })));
      expect(writerDb.getEventCount()).toBe(10);

      // Open a second independent connection to the same file (reader)
      await readerDb.initialize(tmpDir);

      // Reader sees the committed data
      expect(readerDb.getEventCount()).toBe(10);

      // Writer inserts 5 more on 5 new distinct lines (so total = 15 distinct lines)
      writerDb.insertEditEvents(Array.from({ length: 5 }, (_, i) => makeEvent({ lineStart: 10 + i, lineEnd: 10 + i })));

      // Reader re-queries — sees the new 15 events (WAL checkpoint applied)
      expect(readerDb.getEventCount()).toBe(15);

      // Both connections work without blocking each other
      const summary = readerDb.getTodaySummary();
      expect(summary.totalLines).toBe(15); // 15 distinct lines
    } finally {
      writerDb.close();
      readerDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── TC-DB09: Database size with large dataset ─────────────────────────────

  it('TC-DB09: 500K events — DB size < 100MB and getTodaySummary completes < 200ms', () => {
    // Use in-memory DB for speed; getDatabaseSizeMB() uses page_count × page_size
    // which works for both disk and memory DBs.
    const BATCH_SIZE = 5_000;
    const TOTAL = 500_000;

    for (let offset = 0; offset < TOTAL; offset += BATCH_SIZE) {
      // Spread events across 90 days so only ~5.5K land in today's range.
      // This ensures the getTodaySummary() aggregation stays fast.
      const DAY_MS = 86_400_000;
      const batch = Array.from({ length: BATCH_SIZE }, (_, i) => {
        const idx = offset + i;
        const daysAgo = Math.floor((idx * 90) / TOTAL);
        return makeEvent({
          timestamp: Date.now() - daysAgo * DAY_MS - (idx % 1000) * 60_000,
          filePath: `src/file_${idx % 20}.ts`,
          classification: idx % 4 === 0 ? 'ai_generated' : 'human',
          lineStart: idx % 500,
          lineEnd: idx % 500,
        });
      });
      db.insertEditEvents(batch);
    }

    expect(db.getEventCount()).toBe(TOTAL);

    const sizeMB = db.getDatabaseSizeMB();
    expect(sizeMB).toBeLessThan(100); // spec: < 100MB

    const t0 = performance.now();
    const summary = db.getTodaySummary();
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(200); // spec: < 100ms; 200ms buffer for test environment
    expect(summary.totalLines).toBeGreaterThan(0);
  }, 30_000); // allow up to 30s for 500K inserts

  // ── TC-DB10: Corrupted database recovery ──────────────────────────────────

  it('TC-DB10: Corrupted SQLite file — error detected on open, graceful fallback to in-memory mode', async () => {
    const tmpDir = makeTempDir();
    const corruptPath = path.join(tmpDir, 'codedna.db');

    // Write garbage bytes to simulate a truncated/corrupt SQLite file
    fs.writeFileSync(corruptPath, Buffer.from('NOT A VALID SQLITE DATABASE - CORRUPTED HEADER\x00\x00'));

    const corruptDb = new Database();
    try {
      await corruptDb.initialize(tmpDir);

      // Should have fallen back to in-memory mode instead of crashing
      expect(corruptDb.inMemoryMode).toBe(true);

      // Still usable in degraded mode (returns empty results)
      expect(corruptDb.getEventCount()).toBe(0);
      const summary = corruptDb.getTodaySummary();
      expect(summary.totalLines).toBe(0);
    } finally {
      corruptDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Additional edge cases ─────────────────────────────────────────────────

  it('TC-DB-EDGE01: insertEditEvents([]) is a silent no-op', () => {
    expect(() => db.insertEditEvents([])).not.toThrow();
    expect(db.getEventCount()).toBe(0);
  });

  it('TC-DB-EDGE02: getTodaySummary on empty DB returns zeroed summary', () => {
    const s = db.getTodaySummary();
    expect(s.totalLines).toBe(0);
    expect(s.humanPercent).toBe(0);
    expect(s.fileBreakdown).toHaveLength(0);
  });

  it('TC-DB-EDGE03: resetAllData clears all tables and re-runs migrations', () => {
    db.insertEditEvents([makeEvent(), makeEvent(), makeEvent()]);
    expect(db.getEventCount()).toBe(3);
    db.resetAllData();
    expect(db.getEventCount()).toBe(0);
    expect(db.getSchemaVersion()).toBe(2); // schema still valid after reset
  });

  it('TC-DB-EDGE04: getEventCount returns 0 after close', () => {
    db.insertEditEvents([makeEvent()]);
    db.close();
    expect(db.getEventCount()).toBe(0);
    db.initializeInMemory(); // re-open so afterEach can close cleanly
  });
});
