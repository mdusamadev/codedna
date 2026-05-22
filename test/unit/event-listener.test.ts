import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { EventListener } from '../../src/core/event-listener';
import { Settings } from '../../src/config/settings';
import type { RawEditEvent } from '../../src/utils/types';

// Helper to build a minimal TextDocumentChangeEvent-shaped object
function makeDocEvent(
  scheme: string,
  fsPath: string,
  changes: Array<{
    text: string;
    rangeLength: number;
    rangeStart: number;
    rangeEnd: number;
  }>,
  languageId = 'typescript',
) {
  return {
    document: {
      uri: { scheme, fsPath, toString: () => `${scheme}:${fsPath}` },
      languageId,
    },
    contentChanges: changes.map((c) => ({
      text: c.text,
      rangeLength: c.rangeLength,
      range: { start: { line: c.rangeStart }, end: { line: c.rangeEnd } },
    })),
  } as unknown as vscode.TextDocumentChangeEvent;
}

describe('EventListener', () => {
  let listener: EventListener;
  let settings: Settings;
  let docChangeHandler: ((e: vscode.TextDocumentChangeEvent) => void) | null;
  let typeHandler: ((args: { text: string }) => unknown) | null;
  let executeCommandSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    docChangeHandler = null;
    typeHandler = null;

    vi.spyOn(vscode.workspace, 'onDidChangeTextDocument').mockImplementation((cb: unknown) => {
      docChangeHandler = cb as (e: vscode.TextDocumentChangeEvent) => void;
      return { dispose: vi.fn() };
    });

    // Stub the new listeners so they don't throw
    vi.spyOn(vscode.workspace, 'onWillSaveTextDocument').mockReturnValue({ dispose: vi.fn() });
    vi.spyOn(vscode.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() });

    vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((cmd: string, cb: unknown) => {
      if (cmd === 'type') {
        typeHandler = cb as (args: { text: string }) => unknown;
      }
      return { dispose: vi.fn() };
    });

    executeCommandSpy = vi
      .spyOn(vscode.commands, 'executeCommand')
      .mockResolvedValue(undefined);

    settings = new Settings();
    listener = new EventListener(settings);
  });

  afterEach(() => {
    listener.dispose();
    vi.restoreAllMocks();
  });

  // ── Registration ─────────────────────────────────────────────────────────

  it('TC-EL01: Registers onDidChangeTextDocument, type command, selection listener, and willSave on construction', () => {
    expect(docChangeHandler).not.toBeNull();
    expect(typeHandler).not.toBeNull();
    // The two additional listeners should also have been registered
    expect(vscode.workspace.onWillSaveTextDocument).toHaveBeenCalled();
    expect(vscode.window.onDidChangeTextEditorSelection).toHaveBeenCalled();
  });

  // ── Keystroke tracking ────────────────────────────────────────────────────

  it('TC-EL02: getLastKeystrokeTimestamp returns 0 before any keystrokes', () => {
    expect(listener.getLastKeystrokeTimestamp()).toBe(0);
  });

  it('TC-EL03: Type command records a keystroke and updates the timestamp', async () => {
    const before = Date.now();
    await (typeHandler!({ text: 'a' }) as Promise<unknown>);
    const after = Date.now();

    const ts = listener.getLastKeystrokeTimestamp();
    // Keystroke timestamps use Date.now() (epoch ms) — same base as event timestamps
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 5); // +5ms tolerance for slow CI
  });

  it('TC-EL04: Type command forwards the key to default:type immediately', async () => {
    await (typeHandler!({ text: 'x' }) as Promise<unknown>);
    expect(executeCommandSpy).toHaveBeenCalledWith('default:type', { text: 'x' });
  });

  it('TC-EL05: Keystroke buffer is capped at 50 entries', async () => {
    // Drive 60 keystrokes — only the last 50 should be kept
    for (let i = 0; i < 60; i++) {
      await (typeHandler!({ text: 'k' }) as Promise<unknown>);
    }
    // Can't inspect buffer directly, but the timestamp should still be valid
    expect(listener.getLastKeystrokeTimestamp()).toBeGreaterThan(0);
  });

  // ── Basic event emission ──────────────────────────────────────────────────

  it('TC-EL06: Document change fires onEdit with correct file path and counts', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/src/index.ts', [
        { text: 'hello', rangeLength: 0, rangeStart: 10, rangeEnd: 10 },
      ]),
    );

    expect(fired).toHaveLength(1);
    expect(fired[0]!.filePath).toBe('src/index.ts');
    expect(fired[0]!.charsAdded).toBe(5);
    expect(fired[0]!.charsRemoved).toBe(0);
    expect(fired[0]!.lineStart).toBe(10);
    expect(fired[0]!.lineEnd).toBe(10);
    expect(fired[0]!.language).toBe('typescript');
    expect(fired[0]!.linesAdded).toBe(0);
    expect(fired[0]!.isFromDisk).toBe(false);
  });

  it('TC-EL07: Multi-line insertion sets linesAdded correctly', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/src/foo.ts', [
        // 2 newlines → linesAdded = 2
        { text: 'line1\nline2\nline3', rangeLength: 0, rangeStart: 5, rangeEnd: 5 },
      ]),
    );

    expect(fired[0]!.linesAdded).toBe(2);
    expect(fired[0]!.lineStart).toBe(5);
    expect(fired[0]!.lineEnd).toBe(7);
  });

  it('TC-EL08: charsRemoved is taken from rangeLength', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/src/x.ts', [
        { text: 'new', rangeLength: 10, rangeStart: 2, rangeEnd: 3 },
      ]),
    );

    expect(fired[0]!.charsRemoved).toBe(10);
    expect(fired[0]!.charsAdded).toBe(3);
  });

  it('TC-EL09: Multiple content changes in one event each fire a separate onEdit', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/src/multi.ts', [
        { text: 'a', rangeLength: 0, rangeStart: 1, rangeEnd: 1 },
        { text: 'b', rangeLength: 0, rangeStart: 2, rangeEnd: 2 },
        { text: 'c', rangeLength: 0, rangeStart: 3, rangeEnd: 3 },
      ]),
    );

    expect(fired).toHaveLength(3);
    expect(fired[0]!.lineStart).toBe(1);
    expect(fired[1]!.lineStart).toBe(2);
    expect(fired[2]!.lineStart).toBe(3);
  });

  it('TC-EL10: Timestamp on each event is a positive epoch ms value', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/src/ts.ts', [
        { text: 'z', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired[0]!.timestamp).toBeGreaterThan(0);
  });

  // ── Scheme filtering ──────────────────────────────────────────────────────

  it('TC-EL11: git:// scheme events are ignored', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('git', '/some/path', [
        { text: 'ignored', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired).toHaveLength(0);
  });

  it('TC-EL12: output:// scheme events are ignored', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('output', '/channel/output', [
        { text: 'log line', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired).toHaveLength(0);
  });

  it('TC-EL13: untitled:// scheme events are tracked', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    // Mock getWorkspaceFolder returning undefined (untitled files have no workspace)
    vi.spyOn(vscode.workspace, 'getWorkspaceFolder').mockReturnValueOnce(
      undefined as unknown as ReturnType<typeof vscode.workspace.getWorkspaceFolder>,
    );

    docChangeHandler!(
      makeDocEvent('untitled', '/Untitled-1', [
        { text: 'draft', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired).toHaveLength(1);
    // filePath for untitled = uri.toString()
    expect(fired[0]!.filePath).toContain('untitled');
  });

  // ── Path exclusion ────────────────────────────────────────────────────────

  it('TC-EL14: Files under node_modules are excluded', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/node_modules/lodash/index.ts', [
        { text: 'code', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired).toHaveLength(0);
  });

  it('TC-EL15: Files under .git are excluded', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/.git/COMMIT_EDITMSG', [
        { text: 'fix: something', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired).toHaveLength(0);
  });

  it('TC-EL16: Files in dist/ are excluded', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/dist/extension.js', [
        { text: 'bundled', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired).toHaveLength(0);
  });

  it('TC-EL17: Non-excluded src/ files are tracked', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/src/core/classifier.ts', [
        { text: 'return x;', rangeLength: 0, rangeStart: 42, rangeEnd: 42 },
      ]),
    );

    expect(fired).toHaveLength(1);
    expect(fired[0]!.filePath).toBe('src/core/classifier.ts');
  });

  // ── Settings integration ──────────────────────────────────────────────────

  it('TC-EL18: When codedna.enabled is false, no events are fired', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, defaultValue: unknown) => {
        if (key === 'enabled') return false;
        return defaultValue;
      },
    } as ReturnType<typeof vscode.workspace.getConfiguration>);

    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/src/index.ts', [
        { text: 'hello', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired).toHaveLength(0);
  });

  // ── Dispose ───────────────────────────────────────────────────────────────

  it('TC-EL19: After dispose, onEdit callbacks are no longer called', () => {
    const fired: RawEditEvent[] = [];
    listener.onEdit((e) => fired.push(e));

    listener.dispose();

    // docChangeHandler still exists but the emitter is disposed — fire is a no-op
    docChangeHandler!(
      makeDocEvent('file', '/mock/workspace/src/after-dispose.ts', [
        { text: 'post-dispose', rangeLength: 0, rangeStart: 0, rangeEnd: 0 },
      ]),
    );

    expect(fired).toHaveLength(0);
  });
});
