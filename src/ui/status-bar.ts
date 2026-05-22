import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { Settings } from '../config/settings';
import { COMMANDS, DEFAULTS } from '../utils/constants';
import type { ClassifiedEditEvent } from '../utils/types';

/**
 * Status bar indicator showing the real-time human/AI ratio.
 * Format: ✅ H: 67% | 🤖 AI: 28% | ❓ 5%
 */
export class StatusBar implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly settings: Settings;
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  private humanChars = 0;
  private aiChars = 0;
  private ambiguousChars = 0;
  private updateTimeout: ReturnType<typeof setTimeout> | null = null;
  private isDirty = false;

  constructor(settings: Settings) {
    this.settings = settings;

    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = COMMANDS.OPEN_DASHBOARD;
    this.item.name = 'CodeDNA';

    this.updateDisplay();
    this.applyVisibility();

    // Watch for setting changes
    const configListener = this.settings.onDidChange(() => {
      this.applyVisibility();
    });
    this.disposables.push(configListener);

    // Start periodic update
    this.scheduleUpdate();

    this.logger.info('Status bar initialized');
  }

  /** Record a classified event for ratio calculation */
  recordEvent(event: ClassifiedEditEvent): void {
    const chars = event.charsAdded;
    if (chars === 0) return;

    switch (event.classification) {
      case 'human':
        this.humanChars += chars;
        break;
      case 'ai_generated':
      case 'ai_modified':
        this.aiChars += chars;
        break;
      case 'ambiguous':
        this.ambiguousChars += chars;
        break;
    }

    this.isDirty = true;
  }

  /** Reset all counters (new session) */
  reset(): void {
    this.humanChars = 0;
    this.aiChars = 0;
    this.ambiguousChars = 0;
    this.isDirty = true;
    this.updateDisplay();
  }

  dispose(): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    this.item.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private scheduleUpdate(): void {
    this.updateTimeout = setTimeout(() => {
      if (this.isDirty) {
        this.updateDisplay();
        this.isDirty = false;
      }
      this.scheduleUpdate();
    }, DEFAULTS.STATUS_BAR_UPDATE_INTERVAL_MS);
  }

  private updateDisplay(): void {
    const total = this.humanChars + this.aiChars + this.ambiguousChars;

    if (total === 0) {
      this.item.text = '$(pulse) CodeDNA: Waiting for edits...';
      this.item.tooltip = 'CodeDNA — Start coding to see your human/AI ratio';
      return;
    }

    const hPct = Math.round((this.humanChars / total) * 100);
    const aPct = Math.round((this.aiChars / total) * 100);
    const oPct = 100 - hPct - aPct;

    this.item.text = `✅ H: ${hPct}% | 🤖 AI: ${aPct}% | ❓ ${oPct}%`;
    this.item.tooltip = [
      `CodeDNA — Session Ratio`,
      `Human: ${this.humanChars.toLocaleString()} chars (${hPct}%)`,
      `AI: ${this.aiChars.toLocaleString()} chars (${aPct}%)`,
      `Other: ${this.ambiguousChars.toLocaleString()} chars (${oPct}%)`,
      '',
      'Click to open dashboard',
    ].join('\n');
  }

  private applyVisibility(): void {
    if (this.settings.statusBarVisible && this.settings.enabled) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }
}
