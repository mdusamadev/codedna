import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger';

/**
 * Optional git commit hook integration.
 * Installs a prepare-commit-msg hook that appends CodeDNA provenance to commit messages.
 */
export class CommitHook {
  private readonly logger = Logger.getInstance();

  /** Install a prepare-commit-msg hook that appends CodeDNA provenance. */
  install(workspaceRoot: string): void {
    const hookDir = path.join(workspaceRoot, '.git', 'hooks');
    const hookPath = path.join(hookDir, 'prepare-commit-msg');

    if (!fs.existsSync(hookDir)) {
      this.logger.warn('Not a git repository — skipping hook install');
      return;
    }

    const hookContent = [
      '#!/bin/sh',
      '# CodeDNA: auto-appended provenance summary',
      'CODEDNA_DATA=$(cat "$1" | grep -c "CodeDNA:" || true)',
      'if [ "$CODEDNA_DATA" = "0" ]; then',
      '  node "$(dirname "$0")/../../node_modules/.bin/codedna-hook" "$1" 2>/dev/null || true',
      'fi',
    ].join('\n');

    // If hook already exists, append our block with a guard
    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf8');
      if (existing.includes('CodeDNA')) {
        this.logger.info('CodeDNA hook already installed');
        return;
      }
      fs.appendFileSync(hookPath, '\n' + hookContent);
    } else {
      fs.writeFileSync(hookPath, hookContent);
      fs.chmodSync(hookPath, '755');
    }

    this.logger.info(`Git hook installed at: ${hookPath}`);
    void vscode.window.showInformationMessage('CodeDNA: Git commit hook installed.');
  }

  /** Remove the CodeDNA section from the prepare-commit-msg hook. */
  uninstall(workspaceRoot: string): void {
    const hookPath = path.join(workspaceRoot, '.git', 'hooks', 'prepare-commit-msg');
    if (!fs.existsSync(hookPath)) return;

    const content = fs.readFileSync(hookPath, 'utf8');
    const lines = content.split('\n');
    const filtered = lines.filter((l) => !l.includes('CodeDNA'));
    const updated = filtered.join('\n').trim();

    if (updated === '#!/bin/sh' || updated === '') {
      fs.unlinkSync(hookPath);
    } else {
      fs.writeFileSync(hookPath, updated + '\n');
    }

    this.logger.info('Git hook removed');
    void vscode.window.showInformationMessage('CodeDNA: Git commit hook removed.');
  }

  /** Build the provenance summary line for a commit message. */
  buildSummaryLine(humanPct: number, aiPct: number, aiModifiedPct: number): string {
    return `\nCodeDNA: Human ${humanPct}% | AI ${aiPct}% | Modified ${aiModifiedPct}%`;
  }
}
