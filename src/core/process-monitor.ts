import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { Logger } from '../utils/logger';
import { AI_PROCESSES, DEFAULTS } from '../utils/constants';
import type { SourceHint } from '../utils/types';

/**
 * Monitors running processes to detect active AI coding tools.
 * Checks periodically (every 2s) rather than on every edit event.
 */
export class ProcessMonitor implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly onStateChangeEmitter = new vscode.EventEmitter<{
    process: string;
    active: boolean;
  }>();
  private readonly isWindows = process.platform === 'win32';

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private activeProcess: string | null = null;
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;

  /** Fires when an AI process starts or stops */
  readonly onStateChange = this.onStateChangeEmitter.event;

  constructor() {
    this.startMonitoring();
  }

  /** Is any known AI process currently active? */
  isAIProcessActive(): boolean {
    return this.activeProcess !== null;
  }

  /** Get the name of the active AI process, or null */
  getActiveAIProcess(): SourceHint {
    if (this.activeProcess === 'claude') return 'claude';
    if (this.activeProcess === 'cursor-agent') return 'cursor';
    if (this.activeProcess === 'aider') return 'aider';
    return 'unknown';
  }

  dispose(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.onStateChangeEmitter.dispose();
  }

  private startMonitoring(): void {
    // Check immediately on start
    this.checkProcesses();

    // Then check periodically
    this.intervalHandle = setInterval(() => {
      this.checkProcesses();
    }, DEFAULTS.PROCESS_CHECK_INTERVAL_MS);

    this.logger.info('Process monitor started');
  }

  private checkProcesses(): void {
    try {
      const found = this.findAIProcess();

      if (found !== this.activeProcess) {
        const previous = this.activeProcess;
        this.activeProcess = found;

        if (previous) {
          this.onStateChangeEmitter.fire({ process: previous, active: false });
          this.logger.info(`AI process stopped: ${previous}`);
        }
        if (found) {
          this.onStateChangeEmitter.fire({ process: found, active: true });
          this.logger.info(`AI process detected: ${found}`);
        }
      }

      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures++;
      this.logger.warn(`Process check failed (${this.consecutiveFailures}/${this.maxConsecutiveFailures})`, err);

      // Back off after repeated failures
      if (this.consecutiveFailures >= this.maxConsecutiveFailures && this.intervalHandle) {
        clearInterval(this.intervalHandle);
        this.intervalHandle = setInterval(() => {
          this.checkProcesses();
        }, 30_000); // Slow down to 30s
        this.logger.warn('Process monitor backed off to 30s interval due to repeated failures');
      }
    }
  }

  private findAIProcess(): string | null {
    for (const processName of AI_PROCESSES) {
      if (this.isProcessRunning(processName)) {
        return processName;
      }
    }
    return null;
  }

  private isProcessRunning(name: string): boolean {
    try {
      if (this.isWindows) {
        const result = execSync(`tasklist /FI "IMAGENAME eq ${name}.exe" /NH`, {
          encoding: 'utf8',
          timeout: 1000,
          windowsHide: true,
        });
        return !result.includes('No tasks');
      } else {
        const result = execSync(`pgrep -x "${name}" 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 1000,
        });
        return result.trim().length > 0;
      }
    } catch {
      // pgrep returns exit code 1 when no process found — that's normal
      return false;
    }
  }
}
