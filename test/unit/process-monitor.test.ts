import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

// Mock child_process before importing ProcessMonitor
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}));

import { execSync } from 'child_process';
import { ProcessMonitor } from '../../src/core/process-monitor';

describe('ProcessMonitor', () => {
  let monitor: ProcessMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(execSync).mockReturnValue('');
  });

  afterEach(() => {
    monitor?.dispose();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── TC-PM01: Initial state — no process active ────────────────────────────

  it('TC-PM01: isAIProcessActive returns false initially when pgrep returns empty string', () => {
    vi.mocked(execSync).mockReturnValue('');
    monitor = new ProcessMonitor();

    expect(monitor.isAIProcessActive()).toBe(false);
  });

  // ── TC-PM02: Process detected via pgrep PID ───────────────────────────────

  it('TC-PM02: isAIProcessActive returns true when pgrep returns a PID', () => {
    // First call (for 'claude') returns a PID, rest return empty
    vi.mocked(execSync).mockReturnValueOnce('12345\n').mockReturnValue('');
    monitor = new ProcessMonitor();

    expect(monitor.isAIProcessActive()).toBe(true);
  });

  // ── TC-PM03: getActiveAIProcess returns 'claude' ──────────────────────────

  it('TC-PM03: getActiveAIProcess returns "claude" when claude process is found', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if ((cmd as string).includes('"claude"')) return '12345\n';
      return '';
    });
    monitor = new ProcessMonitor();

    expect(monitor.getActiveAIProcess()).toBe('claude');
  });

  // ── TC-PM04: getActiveAIProcess returns 'cursor' ──────────────────────────

  it('TC-PM04: getActiveAIProcess returns "cursor" when cursor-agent process is found', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if ((cmd as string).includes('"claude"')) return '';
      if ((cmd as string).includes('"cursor-agent"')) return '67890\n';
      return '';
    });
    monitor = new ProcessMonitor();

    expect(monitor.getActiveAIProcess()).toBe('cursor');
  });

  // ── TC-PM05: getActiveAIProcess returns 'aider' ───────────────────────────

  it('TC-PM05: getActiveAIProcess returns "aider" when aider process is found', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if ((cmd as string).includes('"claude"')) return '';
      if ((cmd as string).includes('"cursor-agent"')) return '';
      if ((cmd as string).includes('"aider"')) return '11111\n';
      return '';
    });
    monitor = new ProcessMonitor();

    expect(monitor.getActiveAIProcess()).toBe('aider');
  });

  // ── TC-PM06: getActiveAIProcess returns 'unknown' when none active ────────

  it('TC-PM06: getActiveAIProcess returns "unknown" when no AI process is running', () => {
    vi.mocked(execSync).mockReturnValue('');
    monitor = new ProcessMonitor();

    expect(monitor.getActiveAIProcess()).toBe('unknown');
  });

  // ── TC-PM07: onStateChange fires when process starts ─────────────────────

  it('TC-PM07: onStateChange fires with active:true when a process starts', () => {
    // Initial check: no processes
    vi.mocked(execSync).mockReturnValue('');
    monitor = new ProcessMonitor();

    const events: Array<{ process: string; active: boolean }> = [];
    monitor.onStateChange((e) => events.push(e));

    // Next interval check: claude is running
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if ((cmd as string).includes('"claude"')) return '42\n';
      return '';
    });

    vi.advanceTimersByTime(2000);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ process: 'claude', active: true });
  });

  // ── TC-PM08: onStateChange fires when process stops ───────────────────────

  it('TC-PM08: onStateChange fires with active:false when a process stops', () => {
    // Initial check: claude running
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if ((cmd as string).includes('"claude"')) return '42\n';
      return '';
    });
    monitor = new ProcessMonitor();

    expect(monitor.isAIProcessActive()).toBe(true);

    const events: Array<{ process: string; active: boolean }> = [];
    monitor.onStateChange((e) => events.push(e));

    // Next interval check: no processes
    vi.mocked(execSync).mockReturnValue('');

    vi.advanceTimersByTime(2000);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ process: 'claude', active: false });
  });

  // ── TC-PM09: execSync errors are caught, consecutiveFailures incremented ──

  it('TC-PM09: execSync throwing an error is caught and does not crash the monitor', () => {
    // Initial check throws
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('pgrep not found');
    });

    // Should not throw on construction
    expect(() => {
      monitor = new ProcessMonitor();
    }).not.toThrow();

    // Monitor is still alive and reports no active process
    expect(monitor.isAIProcessActive()).toBe(false);
  });

  // ── TC-PM10: After 3 consecutive failures, interval backs off to 30s ──────

  it('TC-PM10: After 3 consecutive top-level failures, interval backs off to 30s', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    // All calls throw so that every checkProcesses() call increments consecutiveFailures.
    // The inner isProcessRunning catches pgrep exit-code errors internally,
    // so we need the outer findAIProcess to throw.
    // We do that by having execSync throw an error with a non-zero exit code
    // but making it propagate out of findAIProcess by throwing from the
    // isProcessRunning method body before the inner try/catch can silence it.
    // Actually isProcessRunning has its own try/catch — so to get the outer
    // catch in checkProcesses we need to arrange for findAIProcess to throw.
    //
    // The only way is to make execSync throw AND have the inner try/catch
    // re-throw — but it doesn't. So instead we'll override by making
    // the ProcessMonitor internal state observable:
    // We advance timers to let 3 intervals fire while execSync always returns
    // empty (no process found = no failure), THEN confirm the normal 2s interval
    // is still running.
    //
    // For real failure back-off we need execSync to throw from OUTSIDE the
    // inner isProcessRunning try/catch. The source code has:
    //   private isProcessRunning(...) { try { execSync... } catch { return false; } }
    // so execSync errors are swallowed there. The outer checkProcesses catch
    // is only reached if findAIProcess throws for some other reason.
    //
    // Therefore: we spy on the private findAIProcess-equivalent path by making
    // execSync throw an Error that the inner catch swallows, confirm monitor
    // stays alive, then demonstrate back-off by patching at a higher level.
    //
    // Since the inner catch swallows execSync errors, we trigger the outer
    // catch by making the execSync mock throw after being called, but arrange
    // for the inner try/catch NOT to swallow — the only way is to override
    // isProcessRunning. Since that's private, we access it via `as any`.

    vi.mocked(execSync).mockReturnValue('');
    monitor = new ProcessMonitor();

    // Patch the private method to throw so checkProcesses() outer catch fires
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (monitor as any).findAIProcess = () => {
      callCount++;
      throw new Error('Simulated failure ' + callCount);
    };

    // Advance 3 intervals — each should increment consecutiveFailures
    vi.advanceTimersByTime(2000); // failure 1
    vi.advanceTimersByTime(2000); // failure 2
    vi.advanceTimersByTime(2000); // failure 3 → back-off

    // After failure 3, a new setInterval at 30000 should have been registered
    const thirtySecCalls = setIntervalSpy.mock.calls.filter(
      (args) => args[1] === 30_000,
    );
    expect(thirtySecCalls.length).toBeGreaterThanOrEqual(1);

    // And clearInterval should have been called (to remove the 2s interval)
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  // ── TC-PM11: dispose() clears the interval ────────────────────────────────

  it('TC-PM11: dispose() clears the interval so no more process checks run', () => {
    vi.mocked(execSync).mockReturnValue('');
    monitor = new ProcessMonitor();

    // Register a listener to detect if any state-change fires after dispose
    const events: Array<{ process: string; active: boolean }> = [];
    monitor.onStateChange((e) => events.push(e));

    monitor.dispose();

    // Now make the mock return a PID — if the interval were still running,
    // a state-change event would fire
    vi.mocked(execSync).mockReturnValue('99999\n');
    vi.advanceTimersByTime(10_000);

    // No events should have fired since the interval was cleared
    expect(events).toHaveLength(0);
  });

  // ── TC-PM12: No duplicate events when process stays active ───────────────

  it('TC-PM12: onStateChange does not fire again if the process is already active', () => {
    // Initial check: claude running
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if ((cmd as string).includes('"claude"')) return '42\n';
      return '';
    });
    monitor = new ProcessMonitor();

    const events: Array<{ process: string; active: boolean }> = [];
    monitor.onStateChange((e) => events.push(e));

    // Advance several intervals — process is still running each time
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);

    // State hasn't changed, so no events should have fired
    expect(events).toHaveLength(0);
  });
});
