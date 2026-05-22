import * as vscode from 'vscode';
import { EXTENSION_ID, DEFAULTS } from '../utils/constants';
import { Logger } from '../utils/logger';

/**
 * Typed, validated access to CodeDNA extension settings.
 * All settings are read from VS Code configuration with fallback defaults.
 */
export class Settings {
  private readonly logger = Logger.getInstance();

  /** Master toggle */
  get enabled(): boolean {
    return this.get<boolean>('enabled', true);
  }

  /** Status bar visibility */
  get statusBarVisible(): boolean {
    return this.get<boolean>('statusBar.visible', true);
  }

  /** Status bar display mode */
  get statusBarMode(): 'session' | 'daily' {
    return this.get<'session' | 'daily'>('statusBar.mode', 'session');
  }

  /** Gutter decorations enabled by default */
  get gutterEnabled(): boolean {
    return this.get<boolean>('gutter.enabled', false);
  }

  /** Git commit summary opt-in */
  get gitCommitSummary(): boolean {
    return this.get<boolean>('git.commitSummary', false);
  }

  /** Data retention in days */
  get retentionDays(): number {
    const value = this.get<number>('retention.days', DEFAULTS.RETENTION_DAYS);
    return this.clamp(value, 7, 365);
  }

  /** Keystroke correlation window in milliseconds */
  get keystrokeWindowMs(): number {
    const value = this.get<number>('classification.keystrokeWindowMs', DEFAULTS.KEYSTROKE_WINDOW_MS);
    return this.clamp(value, 50, 1000);
  }

  /** Minimum lines for batch insertion detection */
  get batchThreshold(): number {
    const value = this.get<number>('classification.batchThreshold', DEFAULTS.BATCH_THRESHOLD);
    return this.clamp(value, 1, 20);
  }

  /** Glob patterns to exclude from tracking */
  get excludePaths(): readonly string[] {
    return this.get<string[]>('excludePaths', [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/*.lock',
      '**/package-lock.json',
      '**/pnpm-lock.yaml',
    ]);
  }

  /** Weekly summary notifications */
  get weeklySummary(): boolean {
    return this.get<boolean>('weeklySummary', false);
  }

  /** Listen for configuration changes */
  onDidChange(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(EXTENSION_ID)) {
        this.logger.info('Settings changed, reloading configuration');
        callback();
      }
    });
  }

  /**
   * Returns a snapshot of all current settings for diagnostic output.
   */
  getDiagnosticSnapshot(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      statusBarVisible: this.statusBarVisible,
      statusBarMode: this.statusBarMode,
      gutterEnabled: this.gutterEnabled,
      gitCommitSummary: this.gitCommitSummary,
      retentionDays: this.retentionDays,
      keystrokeWindowMs: this.keystrokeWindowMs,
      batchThreshold: this.batchThreshold,
      excludePaths: this.excludePaths,
      weeklySummary: this.weeklySummary,
    };
  }

  private get<T>(key: string, defaultValue: T): T {
    const config = vscode.workspace.getConfiguration(EXTENSION_ID);
    return config.get<T>(key, defaultValue);
  }

  private clamp(value: number, min: number, max: number): number {
    if (value < min || value > max) {
      this.logger.warn(`Setting value ${value} out of range [${min}, ${max}], clamping`);
    }
    return Math.max(min, Math.min(max, value));
  }
}
