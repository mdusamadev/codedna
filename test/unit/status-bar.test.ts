import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { StatusBar } from '../../src/ui/status-bar';
import { Settings } from '../../src/config/settings';
import { COMMANDS, DEFAULTS } from '../../src/utils/constants';
import type { ClassifiedEditEvent } from '../../src/utils/types';

/** Factory for a minimal ClassifiedEditEvent */
function makeEvent(
  classification: ClassifiedEditEvent['classification'],
  charsAdded: number,
): ClassifiedEditEvent {
  return {
    timestamp: Date.now(),
    filePath: 'src/test.ts',
    lineStart: 1,
    lineEnd: 1,
    charsAdded,
    charsRemoved: 0,
    linesAdded: 0,
    language: 'typescript',
    isFromDisk: false,
    sessionId: 'test-session',
    classification,
    confidence: 0.95,
    sourceHint: 'unknown',
  };
}

describe('StatusBar', () => {
  let statusBar: StatusBar;
  let settings: Settings;
  let mockItem: {
    show: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    text: string;
    tooltip: string;
    command: string;
    name: string;
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.now() });

    // Create a spy-able mock status bar item
    mockItem = {
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
      text: '',
      tooltip: '',
      command: '',
      name: '',
    };

    vi.spyOn(vscode.window, 'createStatusBarItem').mockReturnValue(
      mockItem as unknown as vscode.StatusBarItem,
    );

    settings = new Settings();
    statusBar = new StatusBar(settings);
  });

  afterEach(() => {
    statusBar.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Construction ───────────────────────────────────────────────────────────

  it('TC-SB01: Creates a status bar item on construction', () => {
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
      vscode.StatusBarAlignment.Left,
      100,
    );
  });

  it('TC-SB02: Initial text shows "Waiting for edits..." message', () => {
    expect(mockItem.text).toContain('Waiting for edits');
  });

  it('TC-SB07: Status bar item command is set to OPEN_DASHBOARD', () => {
    expect(mockItem.command).toBe(COMMANDS.OPEN_DASHBOARD);
  });

  it('TC-SB01b: Status bar item name is set to "CodeDNA"', () => {
    expect(mockItem.name).toBe('CodeDNA');
  });

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('TC-SB05: Status bar item is shown when statusBarVisible=true and enabled=true (defaults)', () => {
    // Defaults: enabled=true, statusBarVisible=true → show() should be called during construction
    expect(mockItem.show).toHaveBeenCalled();
  });

  it('TC-SB06: Status bar item is hidden when statusBarVisible=false', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, defaultValue: unknown) => {
        if (key === 'statusBar.visible') return false;
        if (key === 'enabled') return true;
        return defaultValue;
      },
    } as ReturnType<typeof vscode.workspace.getConfiguration>);

    // Recreate with new mock settings
    statusBar.dispose();
    const hiddenSettings = new Settings();
    statusBar = new StatusBar(hiddenSettings);

    expect(mockItem.hide).toHaveBeenCalled();
  });

  it('TC-SB06b: Status bar item is hidden when enabled=false', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, defaultValue: unknown) => {
        if (key === 'enabled') return false;
        if (key === 'statusBar.visible') return true;
        return defaultValue;
      },
    } as ReturnType<typeof vscode.workspace.getConfiguration>);

    statusBar.dispose();
    const disabledSettings = new Settings();
    statusBar = new StatusBar(disabledSettings);

    expect(mockItem.hide).toHaveBeenCalled();
  });

  // ── recordEvent ────────────────────────────────────────────────────────────

  it('TC-SB03: recordEvent with human chars marks the bar dirty; display updates after timer', () => {
    statusBar.recordEvent(makeEvent('human', 50));

    // Advance past the update interval
    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    expect(mockItem.text).toContain('H:');
    expect(mockItem.text).toContain('AI:');
    expect(mockItem.text).not.toContain('Waiting');
  });

  it('TC-SB08: Multiple events accumulate correctly — 50 human + 50 AI = 50% each', () => {
    statusBar.recordEvent(makeEvent('human', 50));
    statusBar.recordEvent(makeEvent('ai_generated', 50));

    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    // 50 human + 50 AI → H: 50% | AI: 50% | ❓ 0%
    expect(mockItem.text).toContain('H: 50%');
    expect(mockItem.text).toContain('AI: 50%');
  });

  it('TC-SB09: ai_generated and ai_modified both count toward AI percentage', () => {
    statusBar.recordEvent(makeEvent('ai_generated', 30));
    statusBar.recordEvent(makeEvent('ai_modified', 30));
    // 0 human, 60 ai, 0 ambiguous → AI: 100%
    statusBar.recordEvent(makeEvent('human', 0)); // zero-char event is skipped

    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    expect(mockItem.text).toContain('AI: 100%');
    expect(mockItem.text).toContain('H: 0%');
  });

  it('TC-SB09b: zero-char recordEvent is ignored (no counter update)', () => {
    // Record 100 human chars then a zero-char AI event
    statusBar.recordEvent(makeEvent('human', 100));
    statusBar.recordEvent(makeEvent('ai_generated', 0)); // should be skipped

    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    // Should still show 100% human
    expect(mockItem.text).toContain('H: 100%');
    expect(mockItem.text).toContain('AI: 0%');
  });

  it('TC-SB08b: ambiguous chars appear in the ❓ percentage', () => {
    statusBar.recordEvent(makeEvent('human', 50));
    statusBar.recordEvent(makeEvent('ambiguous', 50));

    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    expect(mockItem.text).toContain('H: 50%');
    expect(mockItem.text).toContain('❓');
  });

  // ── reset ──────────────────────────────────────────────────────────────────

  it('TC-SB04: reset() clears counters and immediately returns display to waiting state', () => {
    statusBar.recordEvent(makeEvent('human', 100));

    // Advance to trigger the update cycle first
    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);
    expect(mockItem.text).not.toContain('Waiting');

    statusBar.reset();

    // reset() calls updateDisplay() synchronously
    expect(mockItem.text).toContain('Waiting for edits');
  });

  it('TC-SB04b: After reset, new events accumulate from zero', () => {
    statusBar.recordEvent(makeEvent('ai_generated', 200));
    statusBar.reset();

    // Record new human event
    statusBar.recordEvent(makeEvent('human', 100));
    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    // Only 100 human chars since reset → 100% human
    expect(mockItem.text).toContain('H: 100%');
  });

  // ── Timer behaviour ────────────────────────────────────────────────────────

  it('Display does NOT update if isDirty is false (no events since last update)', () => {
    // After construction, no events yet — text should still be "Waiting"
    const textBeforeAdvance = mockItem.text;
    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);
    // isDirty was never set → updateDisplay not called again → text unchanged
    expect(mockItem.text).toBe(textBeforeAdvance);
  });

  it('Display updates on each timer tick when isDirty=true (recurring schedule)', () => {
    statusBar.recordEvent(makeEvent('human', 10));
    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);
    const textAfterFirst = mockItem.text;
    expect(textAfterFirst).toContain('H: 100%');

    // Add another event and wait for next tick
    statusBar.recordEvent(makeEvent('ai_generated', 10));
    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS + 100);

    // Now 10 human + 10 ai → 50/50
    expect(mockItem.text).toContain('H: 50%');
  });

  // ── dispose ────────────────────────────────────────────────────────────────

  it('TC-SB10: dispose() calls item.dispose()', () => {
    // statusBar.dispose() is also called in afterEach, but we test it here explicitly
    statusBar.dispose();
    expect(mockItem.dispose).toHaveBeenCalled();

    // Prevent double-dispose in afterEach from causing issues by recreating
    statusBar = new StatusBar(settings);
  });

  it('TC-SB10b: dispose() cancels the update timer (no further updates after dispose)', () => {
    statusBar.recordEvent(makeEvent('human', 50));
    statusBar.dispose();

    // Reset text manually to detect any inadvertent update
    mockItem.text = 'SENTINEL';

    vi.advanceTimersByTime(DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS * 3);

    // Timer was cleared — text should still be sentinel
    expect(mockItem.text).toBe('SENTINEL');

    // Recreate for afterEach cleanup
    statusBar = new StatusBar(settings);
  });
});
