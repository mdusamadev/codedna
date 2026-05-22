import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { GutterDecorations } from '../../src/ui/gutter-decorations';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Build a minimal mock text editor */
function makeMockEditor(fileName: string): {
  document: { fileName: string };
  setDecorations: ReturnType<typeof vi.fn>;
} {
  return {
    document: { fileName },
    setDecorations: vi.fn(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('GutterDecorations', () => {
  let gutter: GutterDecorations;

  beforeEach(() => {
    vi.useFakeTimers();
    // Reset visibleTextEditors to empty for each test
    (vscode.window.visibleTextEditors as unknown[]).length = 0;

    // Spy on createTextEditorDecorationType so we can count calls
    vi.spyOn(vscode.window, 'createTextEditorDecorationType').mockImplementation(
      (_options: unknown) => ({
        key: 'mock-decoration',
        dispose: vi.fn(),
      }),
    );

    // No provenance callback → test mode (uses setLineClassification directly)
    gutter = new GutterDecorations(false);
  });

  afterEach(() => {
    gutter.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── TC-GD01: Constructor ──────────────────────────────────────────────────

  it('TC-GD01: constructor creates exactly 4 decoration types', () => {
    expect(vscode.window.createTextEditorDecorationType).toHaveBeenCalledTimes(4);
  });

  // ── TC-GD02: toggle() ─────────────────────────────────────────────────────

  it('TC-GD02a: toggle() enables decorations and applies them to visible editors', () => {
    const editor = makeMockEditor('/workspace/src/foo.ts');
    // Pre-populate a classification so there is something to apply
    gutter.setLineClassification('/workspace/src/foo.ts', 0, 'human');

    // Add editor to the visible list before toggling
    (vscode.window.visibleTextEditors as unknown[]).push(editor);

    gutter.toggle(); // now enabled

    // applyDecorations calls setDecorations 4 times (once per type)
    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
  });

  it('TC-GD02b: toggle() disables decorations and clears them from visible editors', () => {
    const editor = makeMockEditor('/workspace/src/bar.ts');
    (vscode.window.visibleTextEditors as unknown[]).push(editor);

    gutter.toggle(); // enable
    vi.clearAllMocks(); // reset call counts

    gutter.toggle(); // disable — should call clearDecorations → 4 empty-array calls

    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
    // Every call should pass an empty array as the second argument
    for (const call of (editor.setDecorations as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toEqual([]);
    }
  });

  // ── TC-GD03: setLineClassification() ─────────────────────────────────────

  it('TC-GD03: setLineClassification() stores entries and schedules a debounced update', () => {
    const editor = makeMockEditor('/workspace/src/baz.ts');
    (vscode.window.visibleTextEditors as unknown[]).push(editor);

    gutter.toggle(); // enable
    vi.clearAllMocks();

    gutter.setLineClassification('/workspace/src/baz.ts', 5, 'ai_generated');

    // Not yet flushed — debounce hasn't fired
    expect(editor.setDecorations).not.toHaveBeenCalled();

    // Advance past the 500 ms debounce
    vi.advanceTimersByTime(400);

    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
  });

  it('TC-GD03b: setLineClassification() does NOT schedule update when disabled', () => {
    const editor = makeMockEditor('/workspace/src/qux.ts');
    (vscode.window.visibleTextEditors as unknown[]).push(editor);

    // Gutter is disabled (initiallyEnabled=false from beforeEach)
    gutter.setLineClassification('/workspace/src/qux.ts', 3, 'human');
    vi.advanceTimersByTime(400);

    // No decoration calls expected when disabled
    expect(editor.setDecorations).not.toHaveBeenCalled();
  });

  // ── TC-GD04: applyDecorations() ──────────────────────────────────────────

  it('TC-GD04c: gutter shows provenance label and timestamp text per line', () => {
    gutter.toggle();
    const editor = makeMockEditor('/workspace/src/labels.ts');
    const ts = Date.now() - 120_000;

    gutter.setLineClassification('/workspace/src/labels.ts', 0, 'human', ts);
    gutter.setLineClassification('/workspace/src/labels.ts', 1, 'ai_generated', ts);
    gutter.setLineClassification('/workspace/src/labels.ts', 2, 'ai_modified', ts);

    vi.clearAllMocks();
    gutter.updateEditor(editor as unknown as vscode.TextEditor);

    const allOptions = (editor.setDecorations as ReturnType<typeof vi.fn>).mock.calls.flatMap(
      (call) => call[1] as Array<{ renderOptions?: { before?: { contentText?: string } } }>,
    );
    const texts = allOptions
      .map((o) => o.renderOptions?.before?.contentText)
      .filter(Boolean);

    expect(texts.some((t) => t?.startsWith('by you'))).toBe(true);
    expect(texts.some((t) => t?.startsWith('by AI'))).toBe(true);
    expect(texts.some((t) => t?.startsWith('you · AI'))).toBe(true);
    expect(texts.every((t) => t?.includes('·'))).toBe(true);
  });

  it('TC-GD04: updateEditor() calls setDecorations 4 times with correct ranges when enabled', () => {
    gutter.toggle(); // enable
    const editor = makeMockEditor('/workspace/src/main.ts');

    gutter.setLineClassification('/workspace/src/main.ts', 0, 'human');
    gutter.setLineClassification('/workspace/src/main.ts', 1, 'ai_generated');
    gutter.setLineClassification('/workspace/src/main.ts', 2, 'ai_modified');
    gutter.setLineClassification('/workspace/src/main.ts', 3, 'ambiguous');

    vi.clearAllMocks();
    gutter.updateEditor(editor as unknown as vscode.TextEditor);

    expect(editor.setDecorations).toHaveBeenCalledTimes(4);

    // Each call should have exactly one range entry
    for (const call of (editor.setDecorations as ReturnType<typeof vi.fn>).mock.calls) {
      expect((call[1] as unknown[]).length).toBe(1);
    }
  });

  it('TC-GD04b: applyDecorations() produces empty arrays for lines not in lineMap', () => {
    gutter.toggle(); // enable
    const editor = makeMockEditor('/workspace/src/empty.ts');

    vi.clearAllMocks();
    gutter.updateEditor(editor as unknown as vscode.TextEditor);

    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
    for (const call of (editor.setDecorations as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toEqual([]);
    }
  });

  // ── TC-GD05: clearDecorations() ──────────────────────────────────────────

  it('TC-GD05: updateEditor() calls setDecorations with empty arrays when disabled', () => {
    // Gutter is disabled from beforeEach
    const editor = makeMockEditor('/workspace/src/nope.ts');
    gutter.setLineClassification('/workspace/src/nope.ts', 0, 'human');

    gutter.updateEditor(editor as unknown as vscode.TextEditor);

    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
    for (const call of (editor.setDecorations as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toEqual([]);
    }
  });

  // ── TC-GD06: dispose() ───────────────────────────────────────────────────

  it('TC-GD06: dispose() disposes all 4 decoration types', () => {
    // Collect the mocked decoration objects created in the constructor
    const created = (vscode.window.createTextEditorDecorationType as ReturnType<typeof vi.fn>).mock
      .results as Array<{ value: { dispose: ReturnType<typeof vi.fn> } }>;

    gutter.dispose();

    for (const result of created) {
      expect(result.value.dispose).toHaveBeenCalled();
    }
  });
});
