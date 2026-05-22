/**
 * Section 7 — End-to-End Integration Tests (TC-E2E01 to TC-E2E10)
 *
 * Full pipeline: EventListener → Classifier → WriteBuffer + StatusBar + GutterDecorations
 * Uses mocked VS Code APIs and a real in-memory SQLite database.
 * All timestamps use Date.now() (epoch ms) for consistency with DB queries.
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';

import { EventListener } from '../../src/core/event-listener';
import { Classifier } from '../../src/core/classifier';
import { WriteBuffer } from '../../src/storage/write-buffer';
import { StatusBar } from '../../src/ui/status-bar';
import { GutterDecorations } from '../../src/ui/gutter-decorations';
import { Database } from '../../src/storage/database';
import { Settings } from '../../src/config/settings';
import { DEFAULTS } from '../../src/utils/constants';
import type { RawEditEvent, SourceHint } from '../../src/utils/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDocEvent(
  fsPath: string,
  changes: Array<{ text: string; rangeLength: number; rangeStart: number; rangeEnd: number }>,
  languageId = 'typescript',
) {
  return {
    document: {
      uri: { scheme: 'file', fsPath, toString: () => `file:${fsPath}` },
      languageId,
    },
    contentChanges: changes.map((c) => ({
      text: c.text,
      rangeLength: c.rangeLength,
      range: { start: { line: c.rangeStart }, end: { line: c.rangeEnd } },
    })),
  } as unknown as vscode.TextDocumentChangeEvent;
}

interface StatusBarMock {
  text: string; tooltip: string; show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>;
  command: string; name: string;
}

interface Pipeline {
  eventListener: EventListener;
  classifier: Classifier;
  writeBuffer: WriteBuffer;
  statusBar: StatusBar;
  gutter: GutterDecorations;
  db: Database;
  settings: Settings;
  statusBarItem: StatusBarMock;
  triggerDocChange: (event: vscode.TextDocumentChangeEvent) => void;
  /** Set the last keystroke timestamp (epoch ms). Use Date.now()-N for N-ms-ago. */
  setKeystrokeTs: (ts: number) => void;
  setAIActive: (active: boolean, process?: SourceHint) => void;
  dispose: () => void;
}

function buildPipeline(): Pipeline {
  // Start with keystrokeTs far in the past so there's no accidental correlation
  let keystrokeTs = 0;
  let aiActive = false;
  let aiProcessName: SourceHint = 'unknown';
  let docChangeHandler: ((e: vscode.TextDocumentChangeEvent) => void) | null = null;

  vi.spyOn(vscode.workspace, 'onDidChangeTextDocument').mockImplementation((cb: unknown) => {
    docChangeHandler = cb as (e: vscode.TextDocumentChangeEvent) => void;
    return { dispose: vi.fn() };
  });
  vi.spyOn(vscode.commands, 'registerCommand').mockReturnValue({ dispose: vi.fn() });
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

  const statusBarItem: StatusBarMock = {
    text: '', tooltip: '', command: '', name: '',
    show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
  };
  vi.spyOn(vscode.window, 'createStatusBarItem').mockReturnValue(
    statusBarItem as unknown as vscode.StatusBarItem,
  );
  vi.spyOn(vscode.window, 'createTextEditorDecorationType').mockReturnValue({
    key: 'mock-dec', dispose: vi.fn(),
  } as unknown as vscode.TextEditorDecorationType);

  const settings = new Settings();
  const eventListener = new EventListener(settings);
  const classifier = new Classifier(settings, {
    getLastKeystrokeTimestamp: () => keystrokeTs,
    isAIProcessActive: () => aiActive,
    getActiveAIProcess: () => aiProcessName,
    sessionId: 'e2e-session',
  });

  const db = new Database();
  db.initializeInMemory();

  const writeBuffer = new WriteBuffer(db);
  const statusBar = new StatusBar(settings);
  const gutter = new GutterDecorations();

  eventListener.onEdit((raw: RawEditEvent) => {
    const classified = classifier.classify(raw);
    if (classified) {
      writeBuffer.push(classified);
      statusBar.recordEvent(classified);
      gutter.setLineClassification(classified.filePath, classified.lineStart, classified.classification);
    }
  });

  return {
    eventListener, classifier, writeBuffer, statusBar, gutter, db, settings, statusBarItem,
    triggerDocChange: (e) => { if (docChangeHandler) docChangeHandler(e); },
    setKeystrokeTs: (ts) => { keystrokeTs = ts; },
    setAIActive: (active, process = 'claude') => {
      aiActive = active;
      aiProcessName = active ? process : 'unknown';
    },
    dispose: () => {
      eventListener.dispose();
      writeBuffer.dispose();
      statusBar.dispose();
      gutter.dispose();
      db.close();
    },
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('E2E Integration Tests', () => {
  let p: Pipeline;

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.now() });
    p = buildPipeline();
  });

  afterEach(() => {
    p.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── TC-E2E01 ──────────────────────────────────────────────────────────────

  it('TC-E2E01: Full typing session — 50 chars → status bar shows ~100% human', () => {
    // Simulate 50 single-character keystrokes, each within the 200ms window
    for (let i = 0; i < 50; i++) {
      p.setKeystrokeTs(Date.now() - 50); // 50ms ago — within 200ms window
      p.triggerDocChange(makeDocEvent('/mock/workspace/src/main.ts', [
        { text: String.fromCharCode(65 + (i % 26)), rangeLength: 0, rangeStart: i, rangeEnd: i },
      ]));
    }

    // The 50th event triggers an immediate flush (buffer hits limit)
    // DB should now hold all 50 events
    p.writeBuffer.flush();
    expect(p.db.getEventCount()).toBe(50);

    // Advance the 3-second status bar update timer
    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);
    expect(p.statusBarItem.text).toContain('H: 100%');
    expect(p.statusBarItem.text).toContain('AI: 0%');
  });

  // ── TC-E2E02 ──────────────────────────────────────────────────────────────

  it('TC-E2E02: Claude Code simulation — large batch, no keystroke → AI% > 0', () => {
    // No recent keystroke (3s ago, far outside both correlation window and format window)
    p.setKeystrokeTs(Date.now() - 3000);
    p.setAIActive(true, 'claude');

    p.triggerDocChange(makeDocEvent('/mock/workspace/src/generated.ts', [
      {
        text: 'function foo() {\n  return 42;\n}\nfunction bar() {\n  return 0;\n}\n',
        rangeLength: 0,
        rangeStart: 0,
        rangeEnd: 0,
      },
    ]));

    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    // Batch insert with no recent keystroke → ai_generated → AI% > 0
    expect(p.statusBarItem.text).not.toContain('Waiting');
    expect(p.statusBarItem.text).toMatch(/AI: [1-9]\d*%/);
  });

  // ── TC-E2E03 ──────────────────────────────────────────────────────────────

  it('TC-E2E03: Mixed session — human + AI edits → DB summary reflects correct ratio', () => {
    // 20 human single-char edits (keystroke 50ms ago)
    for (let i = 0; i < 20; i++) {
      p.setKeystrokeTs(Date.now() - 50);
      p.triggerDocChange(makeDocEvent('/mock/workspace/src/app.ts', [
        { text: 'a', rangeLength: 0, rangeStart: i, rangeEnd: i },
      ]));
    }

    // 1 AI batch insert (no recent keystroke → outside both windows)
    p.setKeystrokeTs(Date.now() - 3000);
    p.setAIActive(false);
    p.triggerDocChange(makeDocEvent('/mock/workspace/src/app.ts', [
      {
        text: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n',
        rangeLength: 0,
        rangeStart: 20,
        rangeEnd: 20,
      },
    ]));

    // 10 more human chars
    for (let i = 0; i < 10; i++) {
      p.setKeystrokeTs(Date.now() - 50);
      p.triggerDocChange(makeDocEvent('/mock/workspace/src/app.ts', [
        { text: 'b', rangeLength: 0, rangeStart: 30 + i, rangeEnd: 30 + i },
      ]));
    }

    p.writeBuffer.flush();

    const summary = p.db.getTodaySummary();
    expect(summary.totalLines).toBe(40);      // 20 human + 10-line AI batch + 10 human
    expect(summary.humanLines).toBe(30);       // 20 + 10
    expect(summary.aiLines).toBe(10);          // batch spans 10 lines (l1–l10)
    // Ratios are char-weighted (status bar); batch insert adds many AI chars.
    expect(summary.humanChars).toBe(30);
    expect(summary.aiChars).toBeGreaterThan(0);
    expect(summary.humanPercent).toBeGreaterThan(0);
    expect(summary.aiPercent).toBeGreaterThan(0);
    expect(summary.humanPercent + summary.aiPercent + summary.ambiguousPercent).toBe(100);
  });

  // ── TC-E2E04 ──────────────────────────────────────────────────────────────

  it('TC-E2E04: Session persistence — data survives DB close and reopen', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedna-e2e-'));

    const db1 = new Database();
    await db1.initialize(tmpDir);
    db1.insertEditEvents(Array.from({ length: 20 }, (_, i) => ({
      timestamp: Date.now() - i * 1000,
      sessionId: 'session-1',
      filePath: 'src/persist.ts',
      lineStart: i, lineEnd: i,
      charsAdded: 5, charsRemoved: 0, linesAdded: 0,
      language: 'typescript' as const,
      isFromDisk: false as const,
      classification: 'human' as const,
      confidence: 0.95, sourceHint: 'unknown' as const,
    })));
    expect(db1.getEventCount()).toBe(20);
    db1.close();

    // Reopen — data must be there
    const db2 = new Database();
    await db2.initialize(tmpDir);
    expect(db2.getEventCount()).toBe(20);
    const summary = db2.getTodaySummary();
    expect(summary.humanLines).toBe(20);
    db2.close();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── TC-E2E05 ──────────────────────────────────────────────────────────────

  it('TC-E2E05: Gutter decorations accuracy — line classifications match actual edits', () => {
    // Human edit on line 0
    p.setKeystrokeTs(Date.now() - 50);
    p.triggerDocChange(makeDocEvent('/mock/workspace/src/decorated.ts', [
      { text: 'x', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
    ]));

    // AI batch on line 5 (3s ago keystroke → outside both windows)
    p.setKeystrokeTs(Date.now() - 3000);
    p.triggerDocChange(makeDocEvent('/mock/workspace/src/decorated.ts', [
      { text: 'ai1\nai2\nai3\nai4\n', rangeLength: 0, rangeStart: 5, rangeEnd: 5 },
    ]));

    // Gutter stores per-line classifications set by the pipeline
    const gutterMap = p.gutter.lineMap;
    const fileLines = gutterMap.get('src/decorated.ts');
    expect(fileLines).toBeDefined();
    expect(fileLines!.get(0)?.classification).toBe('human');
    expect(fileLines!.get(5)?.classification).toBe('ai_generated');
  });

  // ── TC-E2E06 ──────────────────────────────────────────────────────────────

  it('TC-E2E06: Export data — valid JSON with correct event count', () => {
    for (let i = 0; i < 10; i++) {
      p.setKeystrokeTs(Date.now() - 50);
      p.triggerDocChange(makeDocEvent('/mock/workspace/src/export.ts', [
        { text: 'e', rangeLength: 0, rangeStart: i, rangeEnd: i },
      ]));
    }
    p.writeBuffer.flush();

    // Replicate the export-data command logic
    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '0.1.0',
      eventCount: p.db.getEventCount(),
      todaySummary: p.db.getTodaySummary(),
      trends: p.db.getTrends(
        new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
        new Date().toISOString().slice(0, 10),
      ),
    };

    const json = JSON.stringify(exportData, null, 2);

    // Must be valid JSON
    expect(() => JSON.parse(json)).not.toThrow();

    const parsed = JSON.parse(json) as typeof exportData;
    expect(parsed.eventCount).toBe(10);
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.todaySummary.humanLines).toBe(10);
  });

  // ── TC-E2E07 ──────────────────────────────────────────────────────────────

  it('TC-E2E07: Reset data — all cleared, dashboard empty, status bar at waiting state', () => {
    for (let i = 0; i < 15; i++) {
      p.setKeystrokeTs(Date.now() - 50);
      p.triggerDocChange(makeDocEvent('/mock/workspace/src/reset.ts', [
        { text: 'r', rangeLength: 0, rangeStart: i, rangeEnd: i },
      ]));
    }
    p.writeBuffer.flush();
    expect(p.db.getEventCount()).toBe(15);

    // Reset: DB + in-memory state + UI
    p.db.resetAllData();
    p.classifier.clearLineMap();
    p.statusBar.reset();
    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    expect(p.db.getEventCount()).toBe(0);
    expect(p.db.getTodaySummary().totalLines).toBe(0);
    expect(p.statusBarItem.text).toContain('Waiting');
  });

  // ── TC-E2E08 ──────────────────────────────────────────────────────────────

  it('TC-E2E08: Settings change takes effect immediately — keystrokeWindowMs honoured live', () => {
    // With the default 200ms window, a 250ms-old keystroke is outside → NOT human
    p.setKeystrokeTs(Date.now() - 250);
    p.triggerDocChange(makeDocEvent('/mock/workspace/src/settings.ts', [
      { text: 'x', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
    ]));
    // Small edit + no correlation → ambiguous (falls through to step 5)
    p.writeBuffer.flush();
    const before = p.db.getTodaySummary();
    expect(before.humanLines).toBe(0);

    // Change keystrokeWindowMs to 500ms via settings mock — no restart needed
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, defaultValue: unknown) => {
        if (key === 'classification.keystrokeWindowMs') return 500;
        return defaultValue;
      },
    } as ReturnType<typeof vscode.workspace.getConfiguration>);

    // Same 250ms-old keystroke is now within 500ms → human
    p.setKeystrokeTs(Date.now() - 250);
    p.triggerDocChange(makeDocEvent('/mock/workspace/src/settings.ts', [
      { text: 'y', rangeLength: 0, rangeStart: 1, rangeEnd: 1 },
    ]));
    p.writeBuffer.flush();

    const after = p.db.getTodaySummary();
    expect(after.humanLines).toBe(1); // the second event is now human
    expect(after.totalLines).toBe(2); // both events in DB (first was ambiguous)
  });

  // ── TC-E2E09 ──────────────────────────────────────────────────────────────

  it('TC-E2E09: Multiple workspaces — each DB is isolated, no cross-contamination', async () => {
    const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'codedna-ws-a-'));
    const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'codedna-ws-b-'));
    const dbA = new Database();
    const dbB = new Database();

    try {
      await dbA.initialize(tmpA);
      await dbB.initialize(tmpB);

      const mkEvt = (fp: string, sid: string) => ({
        timestamp: Date.now(), sessionId: sid, filePath: fp,
        lineStart: 1, lineEnd: 1, charsAdded: 1, charsRemoved: 0, linesAdded: 0,
        language: 'typescript' as const, isFromDisk: false as const,
        classification: 'human' as const, confidence: 0.95, sourceHint: 'unknown' as const,
      });

      dbA.insertEditEvents(Array.from({ length: 10 }, () => mkEvt('src/a.ts', 'ws-a')));
      dbB.insertEditEvents(Array.from({ length: 5 }, () => mkEvt('src/b.ts', 'ws-b')));

      expect(dbA.getEventCount()).toBe(10);
      expect(dbB.getEventCount()).toBe(5);

      // No bleeding between workspaces
      expect(dbA.getFileProvenance('src/b.ts')).toHaveLength(0);
      expect(dbB.getFileProvenance('src/a.ts')).toHaveLength(0);
    } finally {
      dbA.close(); dbB.close();
      fs.rmSync(tmpA, { recursive: true, force: true });
      fs.rmSync(tmpB, { recursive: true, force: true });
    }
  });

  // ── TC-E2E10 ──────────────────────────────────────────────────────────────

  it('TC-E2E10: Disable extension → edits not tracked; re-enable → tracking resumes', () => {
    // Phase 1: enabled — 5 events tracked
    for (let i = 0; i < 5; i++) {
      p.setKeystrokeTs(Date.now() - 50);
      p.triggerDocChange(makeDocEvent('/mock/workspace/src/toggle.ts', [
        { text: 'a', rangeLength: 0, rangeStart: i, rangeEnd: i },
      ]));
    }
    expect(p.writeBuffer.getBufferSize()).toBe(5);

    // Phase 2: disable — next 5 events must be ignored
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, defaultValue: unknown) => key === 'enabled' ? false : defaultValue,
    } as ReturnType<typeof vscode.workspace.getConfiguration>);

    for (let i = 5; i < 10; i++) {
      p.setKeystrokeTs(Date.now() - 50);
      p.triggerDocChange(makeDocEvent('/mock/workspace/src/toggle.ts', [
        { text: 'b', rangeLength: 0, rangeStart: i, rangeEnd: i },
      ]));
    }
    expect(p.writeBuffer.getBufferSize()).toBe(5); // unchanged — disabled events dropped

    // Phase 3: re-enable — 3 more events tracked
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (_key: string, defaultValue: unknown) => defaultValue,
    } as ReturnType<typeof vscode.workspace.getConfiguration>);

    for (let i = 10; i < 13; i++) {
      p.setKeystrokeTs(Date.now() - 50);
      p.triggerDocChange(makeDocEvent('/mock/workspace/src/toggle.ts', [
        { text: 'c', rangeLength: 0, rangeStart: i, rangeEnd: i },
      ]));
    }
    expect(p.writeBuffer.getBufferSize()).toBe(8); // 5 + 3

    p.writeBuffer.flush();
    expect(p.db.getEventCount()).toBe(8); // disabled events not in DB
  });
});
